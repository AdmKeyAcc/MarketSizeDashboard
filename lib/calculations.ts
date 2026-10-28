import {
  type Part,
  type Customer,
  type ActualSalesRow,
  type ActualSalesTx,
  type UioUnit,
  type ActualSalesYear,
  type PriceListEntry,
  MONTH_ORDER
} from "@/lib/types";
import { monthsShare } from "@/lib/workdays";
import { DEFAULT_REFERENCES, onReferencesChange, refs } from "@/lib/references";

/** Every filter is multi-select (checklist): an empty array means "no
 * restriction / semua", one or more values means "match any of these" (OR
 * within the field, AND across different fields). */
export type FilterState = {
  tahun: string[];
  bulan: string[];
  area: string[];
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
  tahun: [], bulan: [], area: [],
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
export const UIO_PRODUCT_ALIAS: Record<string, string> = DEFAULT_REFERENCES.productAlias;
// Daftar alias yang dipakai sungguhan dibaca dari tabel Supabase `product_alias` (lib/references.ts).

const canonProductCache = new Map<string, string>();
onReferencesChange(() => canonProductCache.clear());
export function canonicalProduct(p: string | null | undefined): string {
  const raw = String(p || "");
  const hit = canonProductCache.get(raw);
  if (hit !== undefined) return hit;
  const k = raw.trim().toUpperCase();
  const v = refs().productAlias[k] || k;
  if (canonProductCache.size < 50000) canonProductCache.set(raw, v);
  return v;
}

/** Model dinormalisasi (huruf besar, tanpa spasi/tanda hubung) supaya
 * "60-8FD25" dan "60 8FD25" dianggap model yang sama. */
const normModelCache = new Map<string, string>();
export function normModel(m: string | null | undefined): string {
  const raw = String(m || "");
  const hit = normModelCache.get(raw);
  if (hit !== undefined) return hit;
  const v = raw.toUpperCase().replace(/[\s\-_/]+/g, "");
  if (normModelCache.size < 50000) normModelCache.set(raw, v);
  return v;
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
  const anyScope = [f.area, f.customerGroup, f.customerName, f.pss, f.tier].some(
    (arr) => arr.length > 0
  );
  if (!anyScope) return null;
  return getRealCustomers(customers).filter((c) => {
    if (f.area.length > 0 && !setOf(f.area).has(c.cabang || "")) return false;
    if (f.customerGroup.length > 0 && !setOf(f.customerGroup).has(c.customer_group || "")) return false;
    if (f.customerName.length > 0 && !setOf(f.customerName).has(c.customer_name || "")) return false;
    if (f.pss.length > 0 && !setOf(f.pss).has(c.pss || "")) return false;
    if (f.tier.length > 0 && !setOf(f.tier).has(c.tier || "")) return false;
    return true;
  });
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

/* ---------------- Calculator (quick, per-part editable) ---------------- */

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

/** Filter yang butuh data customer (Area via cabang, PSS, Tier) diterjemahkan jadi himpunan kunci "group|nama" customer, lalu dipakai
 * untuk menyaring unit UIO. */
function buildUnitScopeKeys(customers: Customer[] | undefined, f: FilterState | undefined): UnitScopeKeys {
  if (!customers || !f) return { areaKeys: null, otherKeys: null };
  const toSet = (list: Customer[] | null) => (list ? new Set(list.map((c) => custKey(c.customer_group, c.customer_name))) : null);
  const areaKeys = f.area.length > 0 ? toSet(getScopedCustomers(customers, { ...EMPTY_FILTERS, area: f.area })) : null;
  const otherKeys = toSet(
    getScopedCustomers(customers, { ...EMPTY_FILTERS, pss: f.pss, tier: f.tier })
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

/** Unit UIO (satu baris per unit) yang lolos filter & tahun — untuk tabel detail di Dashboard. */
export function uioScopedUnits(uioUnits: UioUnit[], years: number[], f?: FilterState, customers?: Customer[]): UioUnit[] {
  const keys = buildUnitScopeKeys(customers, f);
  return uioUnits.filter((u) => unitInScope(u, years, f, keys));
}

/** Kept for backward compatibility — equivalent to uioByDimension(..., "product"). */
export function uioByProduct(uioUnits: UioUnit[], years: number[], f?: FilterState): UioByProductRow[] {
  return uioByDimension(uioUnits, years, "product", f).map((r) => ({ product: r.label, uio: r.uio }));
}

/* ---------------- Jam operasi (HM) per unit ---------------- */

/** Ringkasan jam operasi sekumpulan unit (satu Product + Model).
 * Annual HM satu unit = HM/Day × Day/Month × Month/Year dari Data UIO.
 * Kolom kosong diisi default dari app_settings: Day/Month → default_workdays_month,
 * Month/Year → app_settings (12). Unit tanpa HM/Day memakai HM/Day Master Part (lalu app_settings),
 * jadi bagian itu baru bisa dihitung per part — disimpan terpisah sebagai `unknownBase`. */
export type UnitHm = {
  units: number;
  /** Jumlah Annual HM unit yang punya HM/Day. */
  knownHm: number;
  /** Jumlah HM/Day unit yang punya HM/Day (untuk rata-rata tampilan). */
  knownHmDay: number;
  /** Jumlah unit tanpa HM/Day. */
  unknownUnits: number;
  /** Jumlah (Day/Month × Month/Year) unit tanpa HM/Day — dikali HM/Day part nanti. */
  unknownBase: number;
};

export const emptyUnitHm = (): UnitHm => ({ units: 0, knownHm: 0, knownHmDay: 0, unknownUnits: 0, unknownBase: 0 });

const inRange = (v: unknown, max: number): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= max ? n : null;
};

/** Hari kerja per bulan untuk sebuah Product (fallback kalau Day/Month unit kosong). */
export type WorkdaysOf = (product: string) => number;

export const defaultWorkdaysOf: WorkdaysOf = () => refs().settings.default_workdays_month;

/** Bagian tahun yang dijalani unit di tahun acuan: unit yang dibeli bulan ke-m di tahun acuan baru beroperasi
 * (13 − m)/12 tahun (dibeli Oktober → 3/12). Tahun sesudahnya penuh. Month Inv kosong = setahun penuh. */
export function firstYearFraction(u: UioUnit, refYear: number | null | undefined): number {
  if (refYear === null || refYear === undefined || u.year !== refYear) return 1;
  const m = Number(u.month_inv);
  return Number.isInteger(m) && m >= 1 && m <= 12 ? (13 - m) / 12 : 1;
}

export function addUnitHm(agg: UnitHm, u: UioUnit, workdaysOf: WorkdaysOf, refYear: number | null = null): void {
  const dm = inRange(u.day_month, 31) ?? workdaysOf(u.product || "");
  const my = inRange(u.month_year, 12) ?? refs().settings.default_months_year;
  const hm = inRange(u.hm_day, 24);
  const w = firstYearFraction(u, refYear);
  agg.units += 1;
  if (hm !== null) {
    agg.knownHm += hm * dm * my * w;
    agg.knownHmDay += hm;
  } else {
    agg.unknownUnits += 1;
    agg.unknownBase += dm * my * w;
  }
}

export function mergeUnitHm(into: UnitHm, from: UnitHm): void {
  into.units += from.units;
  into.knownHm += from.knownHm;
  into.knownHmDay += from.knownHmDay;
  into.unknownUnits += from.unknownUnits;
  into.unknownBase += from.unknownBase;
}

/** Annual HM RATA-RATA per unit untuk satu part (rata-rata × UIO = total jam semua unit),
 * plus HM/Day rata-rata untuk ditampilkan. Tanpa unit sama sekali (Kalkulator cepat dengan UIO manual):
 * HM/Day part × hari kerja × bulan/tahun default. */
export function partAnnualHm(
  agg: UnitHm | null | undefined,
  partHmDay: number | null | undefined,
  product: string,
  workdaysOf: WorkdaysOf
): { annualHm: number; hmDay: number } {
  const s = refs().settings;
  const fallbackHm = inRange(partHmDay, 24) ?? s.default_hm_day;
  if (!agg || agg.units <= 0) {
    return { annualHm: fallbackHm * workdaysOf(product) * s.default_months_year, hmDay: fallbackHm };
  }
  return {
    annualHm: (agg.knownHm + fallbackHm * agg.unknownBase) / agg.units,
    hmDay: (agg.knownHmDay + fallbackHm * agg.unknownUnits) / agg.units
  };
}

export type UnitCounter = {
  /** Jumlah unit untuk Product + Model (sudah kena filter). Kalau tidak ada
   * model yang persis sama, dicoba model yang diawali nama model part
   * (mis. part "1103" → unit "1103A-33G"). */
  count: (product: string, model: string) => number;
  /** Ringkasan jam operasi unit-unit yang sama persis dengan yang dihitung `count`. */
  hours: (product: string, model: string) => UnitHm;
};

export function buildUnitCounter(
  uioUnits: UioUnit[],
  years: number[],
  f?: FilterState,
  customers?: Customer[],
  workdaysOf: WorkdaysOf = defaultWorkdaysOf
): UnitCounter {
  const keys = buildUnitScopeKeys(customers, f);
  // Tahun acuan untuk menghitung bulan beli (unit yang baru dibeli tahun itu hanya dihitung sebagian tahun).
  const refYear = years.length > 0 ? Math.max(...years) : null;
  const byProduct = new Map<string, Map<string, UnitHm>>();
  uioUnits.forEach((u) => {
    if (!unitInScope(u, years, f, keys)) return;
    const p = canonicalProduct(u.product);
    let m = byProduct.get(p);
    if (!m) byProduct.set(p, (m = new Map()));
    const nm = normModel(u.model);
    let agg = m.get(nm);
    if (!agg) m.set(nm, (agg = emptyUnitHm()));
    addUnitHm(agg, u, workdaysOf, refYear);
  });
  const cache = new Map<string, UnitHm>();
  const hours = (product: string, model: string): UnitHm => {
    const p = canonicalProduct(product);
    const nm = normModel(model);
    const ck = `${p}|${nm}`;
    const hit = cache.get(ck);
    if (hit !== undefined) return hit;
    const m = byProduct.get(p);
    let agg = m?.get(nm);
    if (m && (!agg || agg.units === 0) && nm.length >= 3) {
      const sum = emptyUnitHm();
      m.forEach((a, k) => {
        if (k.startsWith(nm)) mergeUnitHm(sum, a);
      });
      agg = sum;
    }
    const out = agg ?? emptyUnitHm();
    cache.set(ck, out);
    return out;
  };
  return {
    count: (product, model) => hours(product, model).units,
    hours
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

export function buildPriceResolver(priceList: PriceListEntry[]) {
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

/** Bagian Market Size setahun untuk periode yang dibandingkan, dibobot hari kerja per bulan
 * (lihat lib/workdays.ts). Bulan = yang dipilih di filter; kalau kosong, bulan yang punya Actual Sales; kalau belum ada, 12 bulan. */
function periodFactor(year: number | null, f: FilterState, cov: Map<number, Set<string>>): number {
  if (f.bulan.length > 0) return monthsShare(f.bulan);
  const m = year === null ? undefined : cov.get(year);
  return m && m.size > 0 ? monthsShare(m) : 1;
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

export type GroupRow = {
  group: string;
  customers: number;
  uio: number;
  qty_market_size: number;
  amount_market_size: number;
  actual_qty: number;
  actual_sales: number;
  market_share: number | null;
  period_market: number;
  amount_per_month: number;
  amount_period: number;
};

/** Ringkas baris Detail part jadi satu baris per Customer Group. UIO dijumlah
 * per kombinasi Product+Model (bukan per part, supaya tidak terhitung ganda). */
export function aggregateGroup(group: string, customers: number, rows: DetailRow[]): GroupRow {
  const uioByModel = new Map<string, number>();
  const g: GroupRow = { group, customers, uio: 0, qty_market_size: 0, amount_market_size: 0, actual_qty: 0, actual_sales: 0, market_share: null, period_market: 0, amount_per_month: 0, amount_period: 0 };
  rows.forEach((r) => {
    uioByModel.set(`${r.product}|${r.model}`, r.uio);
    g.qty_market_size += r.qty_market_size;
    g.amount_market_size += r.amount_market_size;
    g.actual_qty += r.actual_qty;
    g.actual_sales += r.actual_sales;
    g.period_market += r.period_market;
    g.amount_per_month += r.amount_per_month;
    g.amount_period += r.amount_period;
  });
  uioByModel.forEach((v) => (g.uio += v));
  g.market_share = g.period_market > 0 ? g.actual_sales / g.period_market : null;
  return g;
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
  price: number;
  qty_market_size: number;
  amount_market_size: number;
  /** Actual Sales part ini pada tahun acuan (qty & Rp). */
  actual_qty: number;
  actual_sales: number;
  /** Market share = Actual Sales ÷ Market Size periode yang sama (null kalau Market Size 0). */
  market_share: number | null;
  /** Market Size disesuaikan ke periode Actual (dasar penyebut Market share). */
  period_market: number;
  /** Market size per bulan = Price × (Annual HM ÷ 12 ÷ Frekuensi × Qty per unit × UIO), tanpa pembulatan. */
  amount_per_month: number;
  /** Qty & Market size untuk bulan yang dipilih di filter Bulan (kosong = 12 bulan). */
  qty_period: number;
  amount_period: number;
};

/** Baris "Detail part" di page Summary: semua kolom diturunkan dari data
 * (Product & Model dari data part, UIO dari Data UIO per Product+Model,
 * Price dari Data Harga → pricelist, Actual dari Actual Sales per part) dan
 * Qty/Market Size memakai rumus di computePartMarketSize. */
/** Hasil hitung yang sama untuk semua customer/group — dihitung SEKALI lalu dipakai
 * ulang saat buildDetailRows dipanggil berkali-kali (satu panggilan per group/customer). */
export type DetailCtx = {
  years: number[];
  refYear: number | null;
  factor: number;
  priceOf: ReturnType<typeof buildPriceResolver>;
  partsByProduct: Map<string, Part[]>;
};

export function prepareDetailCtx(parts: Part[], uioUnits: UioUnit[], priceList: PriceListEntry[], actualTx: ActualSalesTx[], f: FilterState): DetailCtx {
  const years = resolveUioYears(f, uioUnits);
  const cov = actualCoverage([], actualTx);
  const refYear = referenceYear(f, uioUnits, cov);
  const factor = periodFactor(refYear, f, cov);
  const partsByProduct = new Map<string, Part[]>();
  parts.forEach((p) => {
    const k = canonicalProduct(p.product);
    const arr = partsByProduct.get(k);
    if (arr) arr.push(p);
    else partsByProduct.set(k, [p]);
  });
  return { years, refYear, factor, priceOf: buildPriceResolver(priceList), partsByProduct };
}

export function buildDetailRows(
  parts: Part[],
  uioUnits: UioUnit[],
  priceList: PriceListEntry[],
  customers: Customer[],
  actualTx: ActualSalesTx[],
  f: FilterState,
  /** Opsional: himpunan kunci customer (custKey) dari filter lokal Detail part.
   * Bila diisi, UIO & Actual Sales hanya dihitung dari customer tersebut. */
  customerKeys?: Set<string> | null,
  /** Opsional: unit & transaksi milik customerKeys yang sudah dipisah sebelumnya, plus
   * hasil prepareDetailCtx (supaya tidak menghitung ulang data global tiap panggilan). */
  subset?: { units: UioUnit[]; tx: ActualSalesTx[]; priceGroup?: string; ctx?: DetailCtx }
): DetailRow[] {
  // Tahun acuan & cakupan periode selalu dari SELURUH data, bukan subset customer,
  // supaya setiap customer/group memakai tahun yang sama.
  const ctx = subset?.ctx ?? prepareDetailCtx(parts, uioUnits, priceList, actualTx, f);
  const { years, refYear, factor, priceOf } = ctx;

  let scopedUnits = uioUnits;
  let scopedTx = actualTx;
  if (customerKeys) {
    scopedUnits = subset ? subset.units : uioUnits.filter((u) => customerKeys.has(custKey(u.customer_group, u.customer_name)));
    scopedTx = subset ? subset.tx : actualTx.filter((r) => customerKeys.has(custKey(r.customer_group, r.customer_name)));
  }
  const workdaysOf = defaultWorkdaysOf;
  const counter = buildUnitCounter(scopedUnits, years, f, customers, workdaysOf);
  // Harga kontrak (SCPL) dipakai kalau tepat satu Customer Group (filter, atau group yang sedang dihitung); selain itu harga non kontrak.
  const customerGroup = subset?.priceGroup ?? (f.customerGroup.length === 1 ? f.customerGroup[0] : "");
  const selectedShare = f.bulan.length > 0 ? monthsShare(f.bulan) : 1;

  // Mode customer/group: hanya part dari product yang dimiliki customer itu (unit atau penjualan).
  let candidateParts: Part[] = parts;
  if (customerKeys && subset?.ctx) {
    const prods = new Set<string>();
    scopedUnits.forEach((u) => prods.add(canonicalProduct(u.product)));
    scopedTx.forEach((r) => prods.add(canonicalProduct(r.product)));
    candidateParts = [];
    prods.forEach((k) => {
      const arr = ctx.partsByProduct.get(k);
      if (arr) candidateParts.push(...arr);
    });
  }

  const actualByPart = new Map<string, ActualAgg>();
  if (scopedTx.length > 0 && refYear !== null) {
    const inScope = buildActualScope(f, customers, parts);
    scopedTx.forEach((r) => {
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
  candidateParts.forEach((p) => {
    if (f.product.length > 0 && !setOf(f.product).has(p.product)) return;
    if (f.modelUnit.length > 0 && !setOf(f.modelUnit).has(p.model)) return;
    if (f.partNumber.length > 0 && !setOf(f.partNumber).has(p.part_number || "")) return;
    if (f.partName.length > 0 && !setOf(f.partName).has(p.part_name || "")) return;

    // UIO hanya dari Data UIO: model tanpa unit = UIO 0.
    const hrs = counter.hours(p.product, p.model);
    const uio = hrs.units;
    // Mode customer/group: part tanpa unit & tanpa penjualan tidak berpengaruh ke total.
    if (customerKeys && subset && uio === 0 && !actualByPart.get(`${canonicalProduct(p.product)}|${normModel(p.model)}|${p.part_number || ""}`)) return;
    // Annual HM rata-rata per unit dari HM/Day × Day/Month × Month/Year di Data UIO (fallback: Master Part / default).
    const { annualHm, hmDay } = partAnnualHm(hrs, p.hm_day, p.product, workdaysOf);
    const price = priceOf(p.part_number, customerGroup, p.pricelist);
    const { qty, amount } = computePartMarketSize({
      annualHm,
      freqReplacementHm: p.freq_replacement_hm,
      qtyPerUnit: p.qty_per_unit,
      uio,
      price
    });
    // Market size per bulan & untuk bulan terpilih. Qty dibulatkan SETELAH dikali jumlah bulan.
    // (rata-rata per bulan = setahun ÷ 12; bulan terpilih dibobot hari kerja)
    const monthlyQty = p.freq_replacement_hm > 0 ? ((annualHm / 12) / p.freq_replacement_hm) * p.qty_per_unit * uio : 0;
    const periodQty = Math.round(monthlyQty * 12 * selectedShare);
    const act = actualByPart.get(`${canonicalProduct(p.product)}|${normModel(p.model)}|${p.part_number || ""}`);
    const periodMarket = amount * factor;
    out.push({
      part_id: p.id,
      product: p.product,
      model: p.model,
      part_name: p.part_name,
      part_number: p.part_number,
      hm_day: Math.round(hmDay * 100) / 100,
      annual_hm: annualHm,
      freq_replacement_hm: p.freq_replacement_hm,
      qty_per_unit: p.qty_per_unit,
      uio,
      price,
      qty_market_size: qty,
      amount_market_size: amount,
      actual_qty: act?.qty ?? 0,
      actual_sales: act?.amount ?? 0,
      market_share: periodMarket > 0 ? (act?.amount ?? 0) / periodMarket : null,
      period_market: periodMarket,
      amount_per_month: price * monthlyQty,
      qty_period: periodQty,
      amount_period: price * periodQty
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

/** Actual Sales dari laporan tahunan (actual_sales_year): total Rp per tahun sesuai filter
 * Customer Group / Name / Area / PSS / Sector / KA Type. Filter Bulan, Product, Model dan Part
 * tidak bisa diterapkan (laporan tidak punya rincian itu) — pemanggil menandainya "tidak sebanding". */
export function actualYearTotals(rows: ActualSalesYear[], f: FilterState, customers?: Customer[]): Map<number, number> {
  const out = new Map<number, number>();
  const prods = f.product.length > 0 ? new Set(f.product.map((p) => canonicalProduct(p))) : null;
  const keys = buildUnitScopeKeys(customers, { ...EMPTY_FILTERS, area: f.area, pss: f.pss });
  const groups = f.customerGroup.length > 0 ? new Set(f.customerGroup.map((g) => g.trim().toUpperCase())) : null;
  const names = f.customerName.length > 0 ? new Set(f.customerName.map((g) => g.trim().toUpperCase())) : null;
  const tiers = f.tier.length > 0 ? new Set(f.tier.map((g) => g.trim().toUpperCase())) : null;
  rows.forEach((r) => {
    if (groups && !groups.has(r.customer_group.trim().toUpperCase())) return;
    if (names && !names.has(r.customer_name.trim().toUpperCase())) return;
    if (tiers && !tiers.has((r.ka_type || "").trim().toUpperCase())) return;
    if (prods && !prods.has(canonicalProduct(r.product))) return;
    if (keys.areaKeys || keys.otherKeys) {
      const ck = custKey(r.customer_group, r.customer_name);
      if (keys.areaKeys && !keys.areaKeys.has(ck)) return;
      if (keys.otherKeys && !keys.otherKeys.has(ck)) return;
    }
    out.set(r.year, (out.get(r.year) || 0) + (r.amount || 0));
  });
  return out;
}

/** Bulan yang tercakup data Actual tahunan: tahun terbaru biasanya YTD (Januari–bulan terakhir), tahun lain penuh. */
export function yearlyCoverage(rows: ActualSalesYear[], ytdYear: number | null, ytdMonth: string | null): Map<number, Set<string>> {
  const cov = new Map<number, Set<string>>();
  const ytdIdx = ytdMonth ? (MONTH_ORDER as readonly string[]).indexOf(ytdMonth) : -1;
  rows.forEach((r) => {
    if (cov.has(r.year)) return;
    const n = r.year === ytdYear && ytdIdx >= 0 ? ytdIdx + 1 : 12;
    cov.set(r.year, new Set(MONTH_ORDER.slice(0, n)));
  });
  return cov;
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
  /** false = Actual Sales tahunan tidak bisa dipecah sesuai filter (Bulan/Product/Model/Part), jadi tidak dibandingkan. */
  actual_comparable?: boolean;
};

/** Market Size per tahun = jumlah (Price × ROUND(Annual HM ÷ Frekuensi ganti
 * × Qty/unit × UIO)) dari seluruh part, dengan UIO = unit yang sudah terjual
 * sampai tahun itu. Daftar tahun = gabungan tahun di Data UIO dan di Actual
 * Sales; kalau filter Tahun kosong semua tahun tampil. Market Size diambil
 * untuk periode yang sama dengan Actual Sales (mis. Jan–Agu 2026 = 8/12). */
export function marketSizeByYear(
  parts: Part[],
  uioUnits: UioUnit[],
  priceList: PriceListEntry[],
  actualSales: ActualSalesRow[],
  actualTx: ActualSalesTx[],
  f: FilterState = EMPTY_FILTERS,
  customers?: Customer[],
  /** Laporan Actual Sales tahunan (kalau ada, dipakai menggantikan Actual lama/dummy). */
  actualYear: ActualSalesYear[] = [],
  ytd: { year: number | null; month: string | null } = { year: null, month: null }
): MarketSizeYearRow[] {
  const useYearly = actualYear.length > 0;
  // Filter Product bisa diterapkan kalau laporan Actual diupload per Product; Bulan/Model/Part tetap tidak bisa.
  const actualHasProduct = actualYear.some((r) => !!r.product);
  const yearlyOk = f.bulan.length === 0 && (f.product.length === 0 || actualHasProduct) && f.modelUnit.length === 0 && f.partNumber.length === 0 && f.partName.length === 0;
  const yearlyTotals = useYearly ? actualYearTotals(actualYear, f, customers) : null;
  const actual = useYearly ? new Map<number, ActualAgg>() : actualByYear(actualSales, actualTx, f, customers, parts);
  if (yearlyTotals && yearlyOk) yearlyTotals.forEach((amount, y) => actual.set(y, { amount, qty: 0 }));
  const cov = useYearly ? yearlyCoverage(actualYear, ytd.year, ytd.month) : actualCoverage(actualSales, actualTx);
  const datedYears = uioYearsAvailable(uioUnits);
  let years = Array.from(new Set([...datedYears, ...Array.from(cov.keys())])).sort((a, b) => a - b);
  if (f.tahun.length > 0) {
    const sel = new Set(f.tahun.map((y) => parseInt(y, 10)));
    years = years.filter((y) => sel.has(y));
  }
  if (years.length === 0 || parts.length === 0) return [];

  const priceOf = buildPriceResolver(priceList);
  // Contract Price per Customer Group hanya masuk akal untuk satu grup
  // spesifik — kalau 0 atau lebih dari 1 Customer Group dicentang, pakai
  // harga umum/nasional.
  const customerGroup = f.customerGroup.length === 1 ? f.customerGroup[0] : "";
  const workdaysOf = defaultWorkdaysOf;
  // Tahun & Bulan tidak membatasi populasi unit (UIO dihitung per tahun di bawah).
  const unitFilter = { ...f, tahun: [] as string[], bulan: [] as string[] };

  return years.map((year) => {
    const counter = buildUnitCounter(uioUnits, [year], unitFilter, customers, workdaysOf);
    let total = 0;
    let totalQty = 0;
    parts.forEach((p) => {
      if (f.product.length > 0 && !setOf(f.product).has(p.product)) return;
      if (f.modelUnit.length > 0 && !setOf(f.modelUnit).has(p.model)) return;
      if (f.partNumber.length > 0 && !setOf(f.partNumber).has(p.part_number || "")) return;
      if (f.partName.length > 0 && !setOf(f.partName).has(p.part_name || "")) return;
      // UIO hanya dari Data UIO: model tanpa unit tidak menyumbang Market Size.
      const hrs = counter.hours(p.product, p.model);
      const uio = hrs.units;
      if (uio === 0) return;
      const { annualHm } = partAnnualHm(hrs, p.hm_day, p.product, workdaysOf);
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
    const factor = periodFactor(year, f, cov);
    const a = actual.get(year);
    return {
      year,
      market_size: Math.round(total * factor),
      market_qty: Math.round(totalQty * factor),
      actual_sales: Math.round(a?.amount || 0),
      actual_qty: Math.round(a?.qty || 0),
      period_months: months,
      actual_comparable: useYearly ? yearlyOk : true
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
