import {
  type Part,
  type UioMaster,
  type Assumption,
  type Customer,
  type MonthlyRow,
  type ActualSalesRow,
  type UioUnit,
  type PriceListEntry,
  MONTH_ORDER,
  CUST_BRAND_MAP,
  BUSINESS_AREA_MAP
} from "@/lib/types";

/** Every filter is multi-select (checklist): an empty array means "no
 * restriction / semua", one or more values means "match any of these" (OR
 * within the field, AND across different fields). */
export type FilterState = {
  tahun: string[];
  bulan: string[];
  area: string[];
  businessArea: string[];
  customerGroup: string[];
  customerName: string[];
  pss: string[];
  tier: string[];
  product: string[];
  modelUnit: string[];
  partNumber: string[];
  /** Displayed in the UI as "Part Name" — sourced from parts.part_name
   * (the "Description" column in the Kalkulator template). */
  partName: string[];
};

export const EMPTY_FILTERS: FilterState = {
  tahun: [], bulan: [], area: [], businessArea: [],
  customerGroup: [], customerName: [], pss: [], tier: [],
  product: [], modelUnit: [], partNumber: [], partName: []
};

export function uniq<T>(arr: (T | null | undefined)[]): T[] {
  return Array.from(new Set(arr.filter((v): v is T => v !== null && v !== undefined && v !== ("" as unknown as T))));
}
export function monthIndex(m: string): number {
  const i = MONTH_ORDER.findIndex((x) => x.toLowerCase() === String(m || "").trim().toLowerCase());
  return i < 0 ? 999 : i;
}

export function getRealCustomers(customers: Customer[]): Customer[] {
  return customers.filter((c) => c.customer_name);
}

export function getScopedCustomers(customers: Customer[], f: FilterState): Customer[] | null {
  const anyScope = [f.area, f.customerGroup, f.customerName, f.pss, f.tier].some((arr) => arr.length > 0);
  if (!anyScope) return null;
  return getRealCustomers(customers).filter((c) => {
    if (f.area.length > 0 && !f.area.includes(c.cabang || "")) return false;
    if (f.customerGroup.length > 0 && !f.customerGroup.includes(c.customer_group || "")) return false;
    if (f.customerName.length > 0 && !f.customerName.includes(c.customer_name || "")) return false;
    if (f.pss.length > 0 && !f.pss.includes(c.pss || "")) return false;
    if (f.tier.length > 0 && !f.tier.includes(c.tier || "")) return false;
    return true;
  });
}

export function isScalingActive(customers: Customer[], f: FilterState): boolean {
  return getScopedCustomers(customers, f) !== null;
}

/**
 * Proportional allocation factor: what share of a brand's national UIO
 * falls inside the currently scoped set of customers (by Area / Customer
 * Group / Customer Name / PSS / Tier). Returns 1 (no scaling) when no
 * customer-level filter is active, so the unfiltered view always shows
 * the exact national numbers from the source data.
 */
export function allocationFactor(customers: Customer[], f: FilterState, product: string): number {
  const custCol = CUST_BRAND_MAP[product];
  if (!custCol) return 1;
  const scoped = getScopedCustomers(customers, f);
  if (scoped === null) return 1;
  const all = getRealCustomers(customers);
  const scopedSum = scoped.reduce((s, c) => s + (c.uio_by_brand?.[custCol] || 0), 0);
  const totalSum = all.reduce((s, c) => s + (c.uio_by_brand?.[custCol] || 0), 0);
  if (totalSum === 0) return 0;
  return scopedSum / totalSum;
}

export function allowedProducts(f: FilterState): string[] | null {
  if (f.businessArea.length === 0) return null;
  const set = new Set<string>();
  f.businessArea.forEach((ba) => {
    (BUSINESS_AREA_MAP[ba] || []).forEach((p) => set.add(p));
  });
  return Array.from(set);
}

export type ScaledPart = Part & {
  uio_scaled: number;
  qty_market_size_scaled: number;
  amount_market_size_scaled: number;
  alloc_factor: number;
};

export function filteredParts(parts: Part[], customers: Customer[], f: FilterState): ScaledPart[] {
  const allowed = allowedProducts(f);
  return parts
    .filter((p) => {
      if (allowed && !allowed.includes(p.product)) return false;
      if (f.product.length > 0 && !f.product.includes(p.product)) return false;
      if (f.modelUnit.length > 0 && !f.modelUnit.includes(p.model)) return false;
      if (f.partNumber.length > 0 && !f.partNumber.includes(p.part_number || "")) return false;
      if (f.partName.length > 0 && !f.partName.includes(p.part_name || "")) return false;
      return true;
    })
    .map((p) => {
      const fac = allocationFactor(customers, f, p.product);
      return {
        ...p,
        uio_scaled: (p.uio_qty || 0) * fac,
        qty_market_size_scaled: (p.qty_market_size || 0) * fac,
        amount_market_size_scaled: (p.amount_market_size || 0) * fac,
        alloc_factor: fac
      };
    });
}

/** Derives the {year, month, product} monthly table from current parts
 * totals (market size) combined with whatever actual-sales rows exist. */
export function buildMonthly(parts: Part[], actualSales: ActualSalesRow[]): MonthlyRow[] {
  const totals: Record<string, number> = {};
  parts.forEach((p) => {
    totals[p.product] = (totals[p.product] || 0) + (p.amount_market_size || 0);
  });
  const products = Object.keys(totals);
  let months = uniq(actualSales.map((r) => r.month));
  months.sort((a, b) => monthIndex(a) - monthIndex(b));
  if (months.length === 0) months = MONTH_ORDER.slice(0, 9) as unknown as string[];
  let years = uniq(actualSales.map((r) => r.year));
  if (years.length === 0) years = [2026];

  const rows: MonthlyRow[] = [];
  years.forEach((year) => {
    months.forEach((month) => {
      products.forEach((product) => {
        const match = actualSales.find(
          (r) => String(r.year) === String(year) && r.month === month && r.product === product
        );
        rows.push({
          year,
          month,
          product,
          market_size: Math.round((totals[product] || 0) / 12),
          actual_sales: match ? match.actual_sales || 0 : 0
        });
      });
    });
  });
  return rows;
}

export function monthsInScope(monthly: MonthlyRow[], f: FilterState): string[] {
  if (f.bulan.length > 0) return f.bulan.slice().sort((a, b) => monthIndex(a) - monthIndex(b));
  return uniq(monthly.map((r) => r.month)).sort((a, b) => monthIndex(a) - monthIndex(b));
}

export type ScaledMonthlyRow = MonthlyRow & { market_size_scaled: number; actual_sales_scaled: number };

export function aggregatedMonthly(monthly: MonthlyRow[], customers: Customer[], f: FilterState): ScaledMonthlyRow[] {
  const allowed = allowedProducts(f);
  const months = monthsInScope(monthly, f);
  return monthly
    .filter((r) => {
      if (f.tahun.length > 0 && !f.tahun.includes(String(r.year))) return false;
      if (!months.includes(r.month)) return false;
      if (allowed && !allowed.includes(r.product)) return false;
      if (f.product.length > 0 && !f.product.includes(r.product)) return false;
      return true;
    })
    .map((r) => {
      const fac = allocationFactor(customers, f, r.product);
      return { ...r, market_size_scaled: r.market_size * fac, actual_sales_scaled: r.actual_sales * fac };
    });
}

/* ---------------- Calculator (quick, per-part editable) ---------------- */

export function buildModelLookup(uio: UioMaster[]): Record<string, UioMaster> {
  const lookup: Record<string, UioMaster> = {};
  uio.forEach((u) => {
    const k = (u.model || "").trim().toUpperCase();
    if (!(k in lookup)) lookup[k] = u;
  });
  return lookup;
}

/** Default diskon untuk sebuah product/brand, dipakai sebagai nilai awal
 * kolom Diskon di Quick Calculator (baru bisa diubah manual per part
 * setelahnya — tidak ada lagi tabel "Diskon per brand" yang dibagi
 * bersama). */
export function defaultDiscount(assumptions: Assumption[], product: string): number {
  const base = assumptions.find((a) => a.product === product);
  return base ? base.discount : 0.5;
}

/** Default HM/Day untuk sebuah model, diambil dari uio_master kalau ada
 * (fallback 8 — sesuai permintaan: HM/Day baku 8 jam/hari). */
export function defaultHmDay(lookup: Record<string, UioMaster>, model: string): number {
  const src = lookup[(model || "").trim().toUpperCase()];
  return src?.hm_day || 8;
}

/** Default UIO qty untuk sebuah model: pakai jumlah unit dari Data UIO
 * (populasi riil) di tahun terbaru kalau ada, fallback ke uio_master. */
export function defaultUioQty(
  lookup: Record<string, UioMaster>,
  uioUnits: UioUnit[],
  product: string,
  model: string
): number {
  const year = latestUioYear(uioUnits);
  if (year !== null) {
    const count = uioUnits.filter((u) => u.year === year && u.product === product && u.model === model).length;
    if (count > 0) return count;
  }
  const src = lookup[(model || "").trim().toUpperCase()];
  return src?.uio_qty || 0;
}

export function computeQuickRow(input: {
  qtyPerUnit: number;
  pricelist: number;
  freqReplacementHm: number;
  hmDay: number;
  uio: number;
  discount: number;
  workdaysMonth: number;
}) {
  const annualHm = input.hmDay * input.workdaysMonth * 12;
  const qtyMarketSize = input.freqReplacementHm
    ? (annualHm / input.freqReplacementHm) * input.qtyPerUnit * input.uio
    : 0;
  const contractPrice = input.pricelist * (1 - input.discount);
  const amountMarketSize = contractPrice * qtyMarketSize;
  return { annualHm, qtyMarketSize, contractPrice, amountMarketSize };
}

/* ---------------- Dashboard charts: UIO / Market Size / Market Share per tahun ---------------- */

/** Data UIO adalah populasi per tahun (1 baris = 1 unit fisik pada tahun
 * tertentu) — tidak masuk akal dijumlah lintas tahun karena unit yang sama
 * bisa muncul di beberapa tahun. Semua agregasi di bawah selalu di-scope
 * per tahun. */
export function uioYearsAvailable(uioUnits: UioUnit[]): number[] {
  return uniq(uioUnits.map((u) => u.year))
    .filter((y): y is number => y !== null)
    .sort((a, b) => a - b);
}

export function latestUioYear(uioUnits: UioUnit[]): number | null {
  const years = uioYearsAvailable(uioUnits);
  return years.length ? years[years.length - 1] : null;
}

/** Kalau filter Tahun kosong (tidak ada yang dicentang), chart UIO per
 * Product jatuh ke tahun terbaru yang datanya ada (UIO adalah stok, bukan
 * sesuatu yang dijumlahkan lintas tahun). Kalau satu atau lebih tahun
 * dicentang, semua tahun itu dipakai (dijumlahkan) — checklist = OR. */
export function resolveUioYears(f: FilterState, uioUnits: UioUnit[]): number[] {
  if (f.tahun.length > 0) {
    const nums = f.tahun.map((y) => parseInt(y, 10)).filter((n) => Number.isFinite(n));
    if (nums.length > 0) return nums;
  }
  const latest = latestUioYear(uioUnits);
  return latest !== null ? [latest] : [];
}

export type UioByProductRow = { product: string; uio: number };

export function uioByProduct(uioUnits: UioUnit[], years: number[], f?: FilterState): UioByProductRow[] {
  const totals: Record<string, number> = {};
  uioUnits.forEach((u) => {
    if (years.length > 0 && (u.year === null || !years.includes(u.year))) return;
    if (f) {
      if (f.customerGroup.length > 0 && !f.customerGroup.includes(u.customer_group || "")) return;
      if (f.customerName.length > 0 && !f.customerName.includes(u.customer_name || "")) return;
      if (f.area.length > 0 && !f.area.includes(u.branch || "")) return;
      if (f.product.length > 0 && !f.product.includes(u.product || "")) return;
      if (f.modelUnit.length > 0 && !f.modelUnit.includes(u.model || "")) return;
    }
    const product = u.product || "Lainnya";
    totals[product] = (totals[product] || 0) + 1;
  });
  return Object.entries(totals)
    .map(([product, uio]) => ({ product, uio }))
    .sort((a, b) => b.uio - a.uio);
}

/** Index (tahun|product|model) -> jumlah unit, dibangun sekali supaya
 * menghitung Market Size per tahun untuk banyak part tidak perlu scan
 * ulang seluruh uio_units per part (uio_units bisa puluhan ribu baris). */
export function buildUioIndex(uioUnits: UioUnit[]): Map<string, number> {
  const idx = new Map<string, number>();
  uioUnits.forEach((u) => {
    if (u.year === null) return;
    const key = `${u.year}|${u.product ?? ""}|${u.model ?? ""}`;
    idx.set(key, (idx.get(key) || 0) + 1);
  });
  return idx;
}

function uioCountFromIndex(idx: Map<string, number>, year: number, product: string, model: string): number {
  return idx.get(`${year}|${product}|${model}`) || 0;
}

/** Harga kontrak untuk sebuah Part Number: pakai harga khusus Customer
 * Group kalau ada di Data Harga, lalu harga umum (customer_group kosong),
 * lalu fallback ke pricelist bawaan part itu sendiri. */
export function resolvePrice(
  priceList: PriceListEntry[],
  partNumber: string | null,
  customerGroup: string,
  fallback: number
): number {
  if (partNumber) {
    if (customerGroup) {
      const specific = priceList.find((p) => p.part_number === partNumber && p.customer_group === customerGroup);
      if (specific) return specific.price;
    }
    const general = priceList.find((p) => p.part_number === partNumber && !p.customer_group);
    if (general) return general.price;
  }
  return fallback;
}

export type MarketSizeYearRow = { year: number; market_size: number; actual_sales: number };

/** Market Size per tahun, dihitung dari populasi UIO riil (Data UIO) di
 * tahun itu × formula standar (Annual HM ÷ Freq Replacement × Qty/Unit ×
 * Contract Price), dijumlah dari seluruh part. UIO diambil per tahun
 * (tidak dicampur antar tahun) — sesuai data yang ada, bukan lintas tahun. */
export function marketSizeByYear(
  parts: Part[],
  assumptions: Assumption[],
  uioUnits: UioUnit[],
  priceList: PriceListEntry[],
  actualSales: ActualSalesRow[],
  f?: FilterState
): MarketSizeYearRow[] {
  const years = uioYearsAvailable(uioUnits);
  if (years.length === 0) return [];
  const idx = buildUioIndex(uioUnits);
  // Contract Price per Customer Group hanya masuk akal untuk satu grup
  // spesifik — kalau 0 atau lebih dari 1 Customer Group dicentang, pakai
  // harga umum/nasional (resolvePrice akan fallback otomatis).
  const customerGroup = f?.customerGroup.length === 1 ? f.customerGroup[0] : "";
  const allowed = f ? allowedProducts(f) : null;

  const actualByYear: Record<number, number> = {};
  actualSales.forEach((r) => {
    if (allowed && !allowed.includes(r.product)) return;
    if (f && f.product.length > 0 && !f.product.includes(r.product)) return;
    actualByYear[r.year] = (actualByYear[r.year] || 0) + (r.actual_sales || 0);
  });

  return years.map((year) => {
    let total = 0;
    parts.forEach((p) => {
      if (allowed && !allowed.includes(p.product)) return;
      if (f && f.product.length > 0 && !f.product.includes(p.product)) return;
      if (f && f.modelUnit.length > 0 && !f.modelUnit.includes(p.model)) return;
      const uioCount = uioCountFromIndex(idx, year, p.product, p.model);
      if (uioCount === 0) return;
      const workdaysMonth = assumptions.find((a) => a.product === p.product)?.workdays_month || 22;
      const hmDay = p.hm_day || 8;
      const annualHm = hmDay * workdaysMonth * 12;
      const qtyMs = p.freq_replacement_hm ? (annualHm / p.freq_replacement_hm) * p.qty_per_unit * uioCount : 0;
      const discount = defaultDiscount(assumptions, p.product);
      const basePrice = resolvePrice(priceList, p.part_number, customerGroup, p.pricelist);
      const contractPrice = basePrice * (1 - discount);
      total += qtyMs * contractPrice;
    });
    return { year, market_size: Math.round(total), actual_sales: Math.round(actualByYear[year] || 0) };
  });
}

export type MarketShareYearRow = { year: number; market_share: number };

/** Market Share = Actual Sales ÷ Market Size, per tahun. */
export function marketShareByYear(msRows: MarketSizeYearRow[]): MarketShareYearRow[] {
  return msRows.map((r) => ({
    year: r.year,
    market_share: r.market_size > 0 ? r.actual_sales / r.market_size : 0
  }));
}

/* ---------------- formatting ---------------- */

export function fmtIDR(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${sign}Rp ${(abs / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 2 })} M`;
  if (abs >= 1e6) return `${sign}Rp ${(abs / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 2 })} Jt`;
  return `${sign}Rp ${Math.round(abs).toLocaleString("id-ID")}`;
}
export function fmtIDRFull(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}
export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  return Math.round(n).toLocaleString("id-ID");
}
export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n) || !Number.isFinite(n)) return "–";
  return `${(n * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;
}
