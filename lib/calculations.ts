import {
  type Part,
  type UioMaster,
  type Assumption,
  type Customer,
  type MonthlyRow,
  type ActualSalesRow,
  type ActualSalesTx,
  type UioUnit,
  type PriceListEntry,
  MONTH_ORDER,
  CUST_BRAND_MAP
} from "@/lib/types";

/** Every filter is multi-select (checklist): an empty array means "no
 * restriction / semua", one or more values means "match any of these" (OR
 * within the field, AND across different fields). */
export type FilterState = {
  tahun: string[];
  bulan: string[];
  area: string[];
  /** Customer Sector (Plantation, Rental, Mining, dst) — atribut per customer. */
  sector: string[];
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
  tahun: [], bulan: [], area: [], sector: [],
  customerGroup: [], customerName: [], pss: [], tier: [],
  product: [], modelUnit: [], partNumber: [], partName: []
};

/** Nilai Area yang tidak ditampilkan sebagai pilihan di filter Area
 * (huruf besar/kecil diabaikan). */
export const EXCLUDED_AREAS = ["MHB", "POWER AGCON"];

export function uniq<T>(arr: (T | null | undefined)[]): T[] {
  return Array.from(new Set(arr.filter((v): v is T => v !== null && v !== undefined && v !== ("" as unknown as T))));
}
export function monthIndex(m: string): number {
  const i = MONTH_ORDER.findIndex((x) => x.toLowerCase() === String(m || "").trim().toLowerCase());
  return i < 0 ? 999 : i;
}

/** Kode brand di Data UIO (kolom Product, mis. TYT / PER) → nama Product di
 * data part (TOYOTA / PERKINS). Tanpa pemetaan ini, unit UIO tidak pernah
 * ketemu pasangannya di part, sehingga Market Size per tahun selalu 0. Kode
 * yang tidak ada di daftar dipakai apa adanya. */
export const UIO_PRODUCT_ALIAS: Record<string, string> = {
  TYT: "TOYOTA",
  PER: "PERKINS",
  MFT: "MF",
  KBT: "KUBOTA",
  BTF: "BT",
  GDD: "GD",
  CNC: "CANYCOM",
  FGW: "FG WILSON",
  IRN: "IR",
  LBT: "LINK-BELT"
};

export function canonicalProduct(p: string | null | undefined): string {
  const k = String(p || "").trim().toUpperCase();
  return UIO_PRODUCT_ALIAS[k] || k;
}

/** Model dinormalisasi (huruf besar, tanpa spasi/tanda hubung) supaya
 * "60-8FD25" dan "60 8FD25" dianggap model yang sama. */
export function normModel(m: string | null | undefined): string {
  return String(m || "").toUpperCase().replace(/[\s\-_/]+/g, "");
}

/** Array filter → Set (di-cache per array) supaya cek "apakah nilai ini
 * dipilih" O(1) — penting kalau pilihan ribuan (mis. hasil "Pilih semua"). */
const setCache = new WeakMap<string[], Set<string>>();
function setOf(arr: string[]): Set<string> {
  let s = setCache.get(arr);
  if (!s) setCache.set(arr, (s = new Set(arr)));
  return s;
}

export function custKey(group: string | null | undefined, name: string | null | undefined): string {
  return `${String(group || "").trim().toUpperCase()}|${String(name || "").trim().toUpperCase()}`;
}

export function getRealCustomers(customers: Customer[]): Customer[] {
  return customers.filter((c) => c.customer_name);
}

export function getScopedCustomers(customers: Customer[], f: FilterState): Customer[] | null {
  const anyScope = [f.area, f.sector, f.customerGroup, f.customerName, f.pss, f.tier].some(
    (arr) => arr.length > 0
  );
  if (!anyScope) return null;
  return getRealCustomers(customers).filter((c) => {
    if (f.area.length > 0 && !setOf(f.area).has(c.cabang || "")) return false;
    // Satu customer bisa punya lebih dari satu sector — cocok kalau SALAH
    // SATU sector customer ada di pilihan filter.
    if (f.sector.length > 0 && !(c.customer_sector || []).some((s) => setOf(f.sector).has(s))) return false;
    if (f.customerGroup.length > 0 && !setOf(f.customerGroup).has(c.customer_group || "")) return false;
    if (f.customerName.length > 0 && !setOf(f.customerName).has(c.customer_name || "")) return false;
    if (f.pss.length > 0 && !setOf(f.pss).has(c.pss || "")) return false;
    if (f.tier.length > 0 && !setOf(f.tier).has(c.tier || "")) return false;
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

/** Dulu dipakai untuk menerjemahkan filter "Business Area" (pengelompokan
 * brand statis) jadi daftar product yang diizinkan. Sekarang Business Area
 * sudah jadi atribut per-customer (kode Sales Office / SOff — lihat
 * getScopedCustomers), jadi tidak ada lagi filter yang membatasi daftar
 * product di sini. Fungsi ini dibiarkan ada (selalu null) supaya semua
 * pemanggilnya tidak perlu diubah satu-satu. */
export function allowedProducts(_f: FilterState): string[] | null {
  return null;
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
  return base ? base.discount : 0;
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
  const prod = canonicalProduct(product);
  const mod = normModel(model);
  // UIO = unit yang beroperasi sampai tahun terbaru = semua unit yang sudah
  // terjual (Year Inv) sampai tahun itu, ditambah unit tanpa tahun.
  const count = uioUnits.filter((u) => canonicalProduct(u.product) === prod && normModel(u.model) === mod).length;
  if (count > 0) return count;
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

/** Level agregasi yang bisa dipilih untuk chart UIO ("hierarchy control"):
 * Product adalah level paling ringkas (per brand), Model lebih rinci (per
 * tipe unit), Customer Group paling rinci (per segmen pelanggan). */
export const UIO_DIMENSIONS = ["product", "model", "customerGroup"] as const;
export type UioDimension = (typeof UIO_DIMENSIONS)[number];

export const UIO_DIMENSION_LABELS: Record<UioDimension, string> = {
  product: "Product",
  model: "Model",
  customerGroup: "Customer Group"
};

export type UioAggRow = { label: string; uio: number };

function uioDimensionValue(u: UioUnit, dimension: UioDimension): string {
  if (dimension === "model") return u.model || "Lainnya";
  if (dimension === "customerGroup") return u.customer_group || "Lainnya";
  return u.product || "Lainnya";
}

type UnitScopeKeys = { areaKeys: Set<string> | null; otherKeys: Set<string> | null };

/** Filter yang butuh data customer (Area via cabang, PSS, Tier, Sector) diterjemahkan jadi himpunan kunci "group|nama" customer, lalu dipakai
 * untuk menyaring unit UIO. */
function buildUnitScopeKeys(customers: Customer[] | undefined, f: FilterState | undefined): UnitScopeKeys {
  if (!customers || !f) return { areaKeys: null, otherKeys: null };
  const toSet = (list: Customer[] | null) => (list ? new Set(list.map((c) => custKey(c.customer_group, c.customer_name))) : null);
  const areaKeys = f.area.length > 0 ? toSet(getScopedCustomers(customers, { ...EMPTY_FILTERS, area: f.area })) : null;
  const otherKeys = toSet(
    getScopedCustomers(customers, { ...EMPTY_FILTERS, pss: f.pss, tier: f.tier, sector: f.sector })
  );
  return { areaKeys, otherKeys };
}

/** Unit tanpa tahun (year null) dianggap populasi yang selalu berlaku di
 * tahun mana pun — jadi tetap terhitung walau tahun difilter. */
function unitInScope(u: UioUnit, years: number[], f: FilterState | undefined, keys: UnitScopeKeys): boolean {
  // UIO (unit in operation) pada tahun Y = semua unit yang sudah terjual
  // (Year Inv) sampai tahun Y — unit tahun lalu masih beroperasi. Kalau
  // beberapa tahun dipilih, dipakai tahun terbesar. Unit tanpa tahun selalu ikut.
  if (years.length > 0 && u.year !== null && u.year > Math.max(...years)) return false;
  if (!f) return true;
  if (f.customerGroup.length > 0 && !setOf(f.customerGroup).has(u.customer_group || "")) return false;
  if (f.customerName.length > 0 && !setOf(f.customerName).has(u.customer_name || "")) return false;
  if (f.area.length > 0) {
    const byBranch = setOf(f.area).has(u.branch || "");
    const byCust = keys.areaKeys ? keys.areaKeys.has(custKey(u.customer_group, u.customer_name)) : false;
    if (!byBranch && !byCust) return false;
  }
  if (f.product.length > 0 && !setOf(f.product).has(u.product || "") && !setOf(f.product).has(canonicalProduct(u.product))) return false;
  if (f.modelUnit.length > 0 && !setOf(f.modelUnit).has(u.model || "")) return false;
  if (keys.otherKeys && !keys.otherKeys.has(custKey(u.customer_group, u.customer_name))) return false;
  return true;
}

export function uioByDimension(
  uioUnits: UioUnit[],
  years: number[],
  dimension: UioDimension,
  f?: FilterState,
  customers?: Customer[]
): UioAggRow[] {
  const keys = buildUnitScopeKeys(customers, f);
  const totals: Record<string, number> = {};
  uioUnits.forEach((u) => {
    if (!unitInScope(u, years, f, keys)) return;
    const label = dimension === "product" ? canonicalProduct(u.product) || "Lainnya" : uioDimensionValue(u, dimension);
    totals[label] = (totals[label] || 0) + 1;
  });
  return Object.entries(totals)
    .map(([label, uio]) => ({ label, uio }))
    .sort((a, b) => b.uio - a.uio);
}

export type UioDetailRow = { product: string; model: string; year: number | null; units: number };

/** Tabel rincian UIO: jumlah unit per Product + Model + Tahun delivery (Year Inv),
 * untuk unit yang masuk cakupan filter yang sama dengan chart UIO per Product
 * (unit sampai tahun terpilih, kena filter Area/Sector/Customer/dst). */
export function uioDetailRows(
  uioUnits: UioUnit[],
  years: number[],
  f?: FilterState,
  customers?: Customer[]
): UioDetailRow[] {
  const keys = buildUnitScopeKeys(customers, f);
  const agg = new Map<string, UioDetailRow>();
  uioUnits.forEach((u) => {
    if (!unitInScope(u, years, f, keys)) return;
    const product = canonicalProduct(u.product) || "Lainnya";
    const model = (u.model || "").trim() || "Lainnya";
    const k = `${product}|${model}|${u.year ?? ""}`;
    const r = agg.get(k);
    if (r) r.units += 1;
    else agg.set(k, { product, model, year: u.year, units: 1 });
  });
  return Array.from(agg.values());
}

/** Kept for backward compatibility — equivalent to uioByDimension(..., "product"). */
export function uioByProduct(uioUnits: UioUnit[], years: number[], f?: FilterState): UioByProductRow[] {
  return uioByDimension(uioUnits, years, "product", f).map((r) => ({ product: r.label, uio: r.uio }));
}

export type UnitCounter = {
  /** Jumlah unit untuk Product + Model (sudah kena filter). Kalau tidak ada
   * model yang persis sama, dicoba model yang diawali nama model part
   * (mis. part "1103" → unit "1103A-33G"). */
  count: (product: string, model: string) => number;
};

export function buildUnitCounter(
  uioUnits: UioUnit[],
  years: number[],
  f?: FilterState,
  customers?: Customer[]
): UnitCounter {
  const keys = buildUnitScopeKeys(customers, f);
  const byProduct = new Map<string, Map<string, number>>();
  uioUnits.forEach((u) => {
    if (!unitInScope(u, years, f, keys)) return;
    const p = canonicalProduct(u.product);
    let m = byProduct.get(p);
    if (!m) byProduct.set(p, (m = new Map()));
    const nm = normModel(u.model);
    m.set(nm, (m.get(nm) || 0) + 1);
  });
  const cache = new Map<string, number>();
  return {
    count(product, model) {
      const p = canonicalProduct(product);
      const nm = normModel(model);
      const ck = `${p}|${nm}`;
      const hit = cache.get(ck);
      if (hit !== undefined) return hit;
      const m = byProduct.get(p);
      let n = m ? m.get(nm) || 0 : 0;
      if (m && n === 0 && nm.length >= 3) {
        m.forEach((c, k) => {
          if (k.startsWith(nm)) n += c;
        });
      }
      cache.set(ck, n);
      return n;
    }
  };
}

/** Rumus Market Size per part (sesuai arahan mentor):
 *   Qty Market Size = ROUND(Annual HM ÷ Frekuensi ganti × Qty per unit × UIO)
 *   Market Size (Rp) = Price × Qty Market Size */
export function computePartMarketSize(input: {
  annualHm: number;
  freqReplacementHm: number;
  qtyPerUnit: number;
  uio: number;
  price: number;
}) {
  const qty = input.freqReplacementHm > 0
    ? Math.round((input.annualHm / input.freqReplacementHm) * input.qtyPerUnit * input.uio)
    : 0;
  return { qty, amount: input.price * qty };
}

function buildPriceResolver(priceList: PriceListEntry[]) {
  const idx = new Map<string, number>();
  priceList.forEach((p) => idx.set(`${p.part_number}|${p.customer_group || ""}`, p.price));
  return (partNumber: string | null, customerGroup: string, fallback: number): number => {
    if (partNumber) {
      if (customerGroup) {
        const specific = idx.get(`${partNumber}|${customerGroup}`);
        if (specific !== undefined) return specific;
      }
      const general = idx.get(`${partNumber}|`);
      if (general !== undefined) return general;
    }
    return fallback;
  };
}

/* ---------------- Actual Sales (per transaksi/part) ---------------- */

/** Bulan apa saja yang punya data Actual Sales di tiap tahun (tanpa melihat
 * filter). Dipakai supaya Market Size dibandingkan untuk PERIODE YANG SAMA
 * dengan Actual Sales — mis. 2026 baru ada Januari–Agustus, maka Market Size
 * 2026 dihitung 8/12 tahun. */
export function actualCoverage(actualSales: ActualSalesRow[], actualTx: ActualSalesTx[]): Map<number, Set<string>> {
  const cov = new Map<number, Set<string>>();
  const add = (year: number, month: string) => {
    let m = cov.get(year);
    if (!m) cov.set(year, (m = new Set()));
    m.add(month);
  };
  if (actualTx.length > 0) actualTx.forEach((r) => add(r.year, r.month));
  else actualSales.forEach((r) => add(r.year, r.month));
  return cov;
}

/** Berapa bagian dari Market Size setahun yang dipakai: jumlah bulan yang
 * dipilih di filter Bulan, atau (kalau kosong) jumlah bulan yang punya
 * Actual Sales di tahun itu, atau 12 kalau belum ada Actual Sales. */
function periodMonths(year: number | null, f: FilterState, cov: Map<number, Set<string>>): number {
  if (f.bulan.length > 0) return f.bulan.length;
  const n = year === null ? 0 : cov.get(year)?.size || 0;
  return n > 0 ? n : 12;
}

type TxLike = {
  month: string;
  customer_group: string | null;
  customer_name: string | null;
  product: string | null;
  model: string | null;
  part_number: string | null;
};

/** Penyaring baris Actual Sales sesuai filter dashboard (kecuali Tahun —
 * tahun ditangani pemanggil). Filter customer (Area/Tier/Sector/PSS) lewat
 * himpunan customer yang masuk scope. */
function buildActualScope(f: FilterState, customers: Customer[] | undefined, parts: Part[]) {
  const keys = buildUnitScopeKeys(customers, f);
  const partNameByNo = f.partName.length > 0 ? new Map(parts.map((p) => [p.part_number || "", p.part_name])) : null;
  const models = f.modelUnit.length > 0 ? new Set(f.modelUnit.map(normModel)) : null;
  return (r: TxLike): boolean => {
    if (f.bulan.length > 0 && !setOf(f.bulan).has(r.month)) return false;
    if (f.customerGroup.length > 0 && !setOf(f.customerGroup).has(r.customer_group || "")) return false;
    if (f.customerName.length > 0 && !setOf(f.customerName).has(r.customer_name || "")) return false;
    if (keys.areaKeys || keys.otherKeys) {
      const ck = custKey(r.customer_group, r.customer_name);
      if (keys.areaKeys && !keys.areaKeys.has(ck)) return false;
      if (keys.otherKeys && !keys.otherKeys.has(ck)) return false;
    }
    if (f.product.length > 0 && !setOf(f.product).has(canonicalProduct(r.product))) return false;
    if (models && !models.has(normModel(r.model))) return false;
    if (f.partNumber.length > 0 && !setOf(f.partNumber).has(r.part_number || "")) return false;
    if (partNameByNo && !setOf(f.partName).has(partNameByNo.get(r.part_number || "") || "")) return false;
    return true;
  };
}

type ActualAgg = { amount: number; qty: number };

/** Total Actual Sales (Rp & qty) per tahun, sesuai filter. Kalau tabel per
 * transaksi masih kosong, dipakai tabel Actual Sales lama (per product,
 * tanpa qty). */
function actualByYear(
  actualSales: ActualSalesRow[],
  actualTx: ActualSalesTx[],
  f: FilterState,
  customers: Customer[] | undefined,
  parts: Part[]
): Map<number, ActualAgg> {
  const out = new Map<number, ActualAgg>();
  const bump = (year: number, amount: number, qty: number) => {
    const a = out.get(year);
    if (a) {
      a.amount += amount;
      a.qty += qty;
    } else out.set(year, { amount, qty });
  };
  if (actualTx.length > 0) {
    const inScope = buildActualScope(f, customers, parts);
    actualTx.forEach((r) => {
      if (inScope(r)) bump(r.year, r.amount || 0, r.qty || 0);
    });
  } else {
    actualSales.forEach((r) => {
      if (f.product.length > 0 && !setOf(f.product).has(canonicalProduct(r.product))) return;
      if (f.bulan.length > 0 && !setOf(f.bulan).has(r.month)) return;
      bump(r.year, r.actual_sales || 0, 0);
    });
  }
  return out;
}

/** Tahun acuan Detail part: tahun terbesar yang dipilih di filter Tahun,
 * kalau kosong tahun terbaru yang punya data. */
function referenceYear(f: FilterState, uioUnits: UioUnit[], cov: Map<number, Set<string>>): number | null {
  const sel = f.tahun.map((y) => parseInt(y, 10)).filter((n) => Number.isFinite(n));
  if (sel.length > 0) return Math.max(...sel);
  const latest = latestUioYear(uioUnits);
  const covYears = Array.from(cov.keys());
  const all = [...(latest !== null ? [latest] : []), ...covYears];
  return all.length > 0 ? Math.max(...all) : null;
}

export type DetailRow = {
  /** id baris di tabel parts — dipakai untuk menyimpan hasil edit. */
  part_id?: number;
  product: string;
  model: string;
  part_name: string;
  part_number: string | null;
  hm_day: number;
  annual_hm: number;
  freq_replacement_hm: number;
  qty_per_unit: number;
  uio: number;
  /** "unit" = dihitung dari Data UIO; "template" = belum ada Data UIO untuk
   * model ini, dipakai angka UIO dari template kalkulator. */
  uio_source: "unit" | "template";
  price: number;
  qty_market_size: number;
  amount_market_size: number;
  /** Actual Sales part ini pada tahun acuan (qty & Rp). */
  actual_qty: number;
  actual_sales: number;
  /** Market share = Actual Sales ÷ Market Size periode yang sama (null kalau Market Size 0). */
  market_share: number | null;
};

/** Baris "Detail part" di page Summary: semua kolom diturunkan dari data
 * (Product & Model dari data part, UIO dari Data UIO per Product+Model,
 * Price dari Data Harga → pricelist, Actual dari Actual Sales per part) dan
 * Qty/Market Size memakai rumus di computePartMarketSize. */
export function buildDetailRows(
  parts: Part[],
  assumptions: Assumption[],
  uioUnits: UioUnit[],
  priceList: PriceListEntry[],
  customers: Customer[],
  actualTx: ActualSalesTx[],
  f: FilterState,
  /** Opsional: himpunan kunci customer (custKey) dari filter lokal Detail part.
   * Bila diisi, UIO & Actual Sales hanya dihitung dari customer tersebut. */
  customerKeys?: Set<string> | null
): DetailRow[] {
  const allUnits = uioUnits;
  if (customerKeys) {
    uioUnits = uioUnits.filter((u) => customerKeys.has(custKey(u.customer_group, u.customer_name)));
    actualTx = actualTx.filter((r) => customerKeys.has(custKey(r.customer_group, r.customer_name)));
  }
  const years = resolveUioYears(f, allUnits);
  const counter = buildUnitCounter(uioUnits, years, f, customers);
  const allCounter = buildUnitCounter(allUnits, [], undefined, undefined);
  const priceOf = buildPriceResolver(priceList);
  const customerGroup = f.customerGroup.length === 1 ? f.customerGroup[0] : "";
  const workdaysOf = (product: string) => assumptions.find((a) => a.product === product)?.workdays_month || 22;

  // Actual Sales per part pada tahun acuan.
  const cov = actualCoverage([], actualTx);
  const refYear = referenceYear(f, uioUnits, cov);
  const factor = periodMonths(refYear, f, cov) / 12;
  const actualByPart = new Map<string, ActualAgg>();
  if (actualTx.length > 0 && refYear !== null) {
    const inScope = buildActualScope(f, customers, parts);
    actualTx.forEach((r) => {
      if (r.year !== refYear || !inScope(r)) return;
      const k = `${canonicalProduct(r.product)}|${normModel(r.model)}|${r.part_number || ""}`;
      const a = actualByPart.get(k);
      if (a) {
        a.amount += r.amount || 0;
        a.qty += r.qty || 0;
      } else actualByPart.set(k, { amount: r.amount || 0, qty: r.qty || 0 });
    });
  }

  const out: DetailRow[] = [];
  parts.forEach((p) => {
    if (f.product.length > 0 && !setOf(f.product).has(p.product)) return;
    if (f.modelUnit.length > 0 && !setOf(f.modelUnit).has(p.model)) return;
    if (f.partNumber.length > 0 && !setOf(f.partNumber).has(p.part_number || "")) return;
    if (f.partName.length > 0 && !setOf(f.partName).has(p.part_name || "")) return;

    let uio = counter.count(p.product, p.model);
    let source: "unit" | "template" = "unit";
    if (uio === 0 && allCounter.count(p.product, p.model) === 0) {
      // Template hanya untuk model tanpa data unit sama sekali; kalau customer
      // dipilih, UIO-nya 0 (tidak ada unit milik customer itu).
      uio = customerKeys ? 0 : (p.uio_qty || 0) * allocationFactor(customers, f, p.product);
      source = "template";
    }
    const annualHm = (p.hm_day || 8) * workdaysOf(p.product) * 12;
    const price = priceOf(p.part_number, customerGroup, p.pricelist);
    const { qty, amount } = computePartMarketSize({
      annualHm,
      freqReplacementHm: p.freq_replacement_hm,
      qtyPerUnit: p.qty_per_unit,
      uio,
      price
    });
    const act = actualByPart.get(`${canonicalProduct(p.product)}|${normModel(p.model)}|${p.part_number || ""}`);
    const periodMarket = amount * factor;
    out.push({
      part_id: p.id,
      product: p.product,
      model: p.model,
      part_name: p.part_name,
      part_number: p.part_number,
      hm_day: p.hm_day || 8,
      annual_hm: annualHm,
      freq_replacement_hm: p.freq_replacement_hm,
      qty_per_unit: p.qty_per_unit,
      uio,
      uio_source: source,
      price,
      qty_market_size: qty,
      amount_market_size: amount,
      actual_qty: act?.qty ?? 0,
      actual_sales: act?.amount ?? 0,
      market_share: periodMarket > 0 ? (act?.amount ?? 0) / periodMarket : null
    });
  });
  return out;
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

export type PartWithoutPrice = { product: string; model: string; part_number: string; part_name: string };

/** Part Number yang "gagal" dapat harga: tidak ada entri cocok di Data
 * Harga (baik harga khusus per Customer Group maupun harga umum), dan
 * pricelist bawaan part itu sendiri juga 0 — sehingga Contract Price-nya
 * jadi 0 dan part ini otomatis tidak menyumbang apa pun ke Market Size.
 * Dipakai untuk daftar "Part Number tanpa harga" di modal info. */
export function findPartsWithoutPrice(parts: Part[], priceList: PriceListEntry[]): PartWithoutPrice[] {
  const priced = new Set(priceList.map((p) => p.part_number));
  const seen = new Set<string>();
  const out: PartWithoutPrice[] = [];
  parts.forEach((p) => {
    if (!p.part_number) return;
    if (priced.has(p.part_number)) return;
    if (p.pricelist && p.pricelist > 0) return;
    const key = `${p.product}|${p.model}|${p.part_number}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ product: p.product, model: p.model, part_number: p.part_number, part_name: p.part_name || "" });
  });
  return out;
}

export type MarketSizeYearRow = {
  year: number;
  /** Market Size (Rp) untuk periode yang sama dengan Actual Sales. */
  market_size: number;
  actual_sales: number;
  /** Market Size & Actual Sales dalam jumlah (qty). */
  market_qty: number;
  actual_qty: number;
  /** Jumlah bulan yang dibandingkan di tahun ini (12 = setahun penuh). */
  period_months: number;
};

/** Market Size per tahun = jumlah (Price × ROUND(Annual HM ÷ Frekuensi ganti
 * × Qty/unit × UIO)) dari seluruh part, dengan UIO = unit yang sudah terjual
 * sampai tahun itu. Daftar tahun = gabungan tahun di Data UIO dan di Actual
 * Sales; kalau filter Tahun kosong semua tahun tampil. Market Size diambil
 * untuk periode yang sama dengan Actual Sales (mis. Jan–Agu 2026 = 8/12). */
export function marketSizeByYear(
  parts: Part[],
  assumptions: Assumption[],
  uioUnits: UioUnit[],
  priceList: PriceListEntry[],
  actualSales: ActualSalesRow[],
  actualTx: ActualSalesTx[],
  f: FilterState = EMPTY_FILTERS,
  customers?: Customer[]
): MarketSizeYearRow[] {
  const actual = actualByYear(actualSales, actualTx, f, customers, parts);
  const cov = actualCoverage(actualSales, actualTx);
  const datedYears = uioYearsAvailable(uioUnits);
  let years = Array.from(new Set([...datedYears, ...Array.from(cov.keys())])).sort((a, b) => a - b);
  if (f.tahun.length > 0) {
    const sel = new Set(f.tahun.map((y) => parseInt(y, 10)));
    years = years.filter((y) => sel.has(y));
  }
  if (years.length === 0 || parts.length === 0) return [];

  const allCounter = buildUnitCounter(uioUnits, [], undefined, undefined);
  const priceOf = buildPriceResolver(priceList);
  // Contract Price per Customer Group hanya masuk akal untuk satu grup
  // spesifik — kalau 0 atau lebih dari 1 Customer Group dicentang, pakai
  // harga umum/nasional.
  const customerGroup = f.customerGroup.length === 1 ? f.customerGroup[0] : "";
  const workdaysCache = new Map<string, number>();
  const workdaysOf = (product: string) => {
    let w = workdaysCache.get(product);
    if (w === undefined) {
      w = assumptions.find((a) => a.product === product)?.workdays_month || 22;
      workdaysCache.set(product, w);
    }
    return w;
  };
  // Tahun & Bulan tidak membatasi populasi unit (UIO dihitung per tahun di bawah).
  const unitFilter = { ...f, tahun: [] as string[], bulan: [] as string[] };

  return years.map((year) => {
    const counter = buildUnitCounter(uioUnits, [year], unitFilter, customers);
    let total = 0;
    let totalQty = 0;
    parts.forEach((p) => {
      if (f.product.length > 0 && !setOf(f.product).has(p.product)) return;
      if (f.modelUnit.length > 0 && !setOf(f.modelUnit).has(p.model)) return;
      if (f.partNumber.length > 0 && !setOf(f.partNumber).has(p.part_number || "")) return;
      if (f.partName.length > 0 && !setOf(f.partName).has(p.part_name || "")) return;
      let uio = counter.count(p.product, p.model);
      if (uio === 0 && allCounter.count(p.product, p.model) === 0) {
        uio = (p.uio_qty || 0) * (customers ? allocationFactor(customers, f, p.product) : 1);
      }
      if (uio === 0) return;
      const annualHm = (p.hm_day || 8) * workdaysOf(p.product) * 12;
      const price = priceOf(p.part_number, customerGroup, p.pricelist);
      const r = computePartMarketSize({
        annualHm,
        freqReplacementHm: p.freq_replacement_hm,
        qtyPerUnit: p.qty_per_unit,
        uio,
        price
      });
      total += r.amount;
      totalQty += r.qty;
    });
    const months = periodMonths(year, f, cov);
    const factor = months / 12;
    const a = actual.get(year);
    return {
      year,
      market_size: Math.round(total * factor),
      market_qty: Math.round(totalQty * factor),
      actual_sales: Math.round(a?.amount || 0),
      actual_qty: Math.round(a?.qty || 0),
      period_months: months
    };
  });
}

export type MarketShareYearRow = { year: number; market_share: number; period_months: number };

/** Market Share = Actual Sales ÷ Market Size (persentase), per tahun. */
export function marketShareByYear(msRows: MarketSizeYearRow[]): MarketShareYearRow[] {
  return msRows.map((r) => ({
    year: r.year,
    market_share: r.market_size > 0 ? r.actual_sales / r.market_size : 0,
    period_months: r.period_months
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
