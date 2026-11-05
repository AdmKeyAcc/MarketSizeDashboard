import { canonicalProduct, custKey, monthIndex } from "@/lib/calculations";
import { kaRank } from "@/lib/references";
import { MONTH_ORDER, type UioUnit } from "@/lib/types";

/** Filter khusus bagian UIO di Dashboard (chart UIO per Product & Detail UIO) — terpisah dari filter Market. */
export type UioFilterState = {
  yearBast: string[];
  monthBast: string[];
  branch: string[];
  custType: string[];
  customerName: string[];
  customerGroup: string[];
  pss: string[];
  product: string[];
  model: string[];
  priceType: string[];
};
export type UioFilterKey = keyof UioFilterState;

export const EMPTY_UIO_FILTERS: UioFilterState = {
  yearBast: [], monthBast: [], branch: [], custType: [], customerName: [], customerGroup: [], pss: [], product: [], model: [], priceType: []
};

export const UIO_FILTER_LABELS: Record<UioFilterKey, string> = {
  yearBast: "Year BAST", monthBast: "Month BAST", branch: "Branch", custType: "Customer Type", customerName: "Customer Name",
  customerGroup: "Customer Group", pss: "PSS", product: "Product", model: "Model", priceType: "Price Type"
};

const NONE = "(kosong)";
const t = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s === "" ? NONE : s;
};

/** Nilai satu unit untuk tiap filter. Customer Type = Customer Type customer-nya di Dashboard (Actual / Master Customer),
 * kalau tidak ada kolom Cust. Type di Data UIO. */
export function uioValueOf(k: UioFilterKey, u: UioUnit, custType: Map<string, string>): string {
  switch (k) {
    case "yearBast": return t(u.year);
    case "monthBast": return u.month_inv ? MONTH_ORDER[Number(u.month_inv) - 1] ?? NONE : NONE;
    case "branch": return t(u.branch?.toUpperCase());
    case "custType": return custType.get(custKey(u.customer_group, u.customer_name)) || t(u.customer_type?.toUpperCase());
    case "customerName": return t(u.customer_name);
    case "customerGroup": return t(u.customer_group);
    case "pss": return t(u.pss_name);
    case "product": return u.product ? canonicalProduct(u.product) : NONE;
    case "model": return t(u.model);
    case "priceType": return t(u.price_type);
  }
}

const KEYS = Object.keys(EMPTY_UIO_FILTERS) as UioFilterKey[];

/** Unit yang lolos filter UIO (kecuali satu kunci `except`, untuk daftar pilihan bertingkat). */
export function filterUioUnits(units: UioUnit[], f: UioFilterState, custType: Map<string, string>, except?: UioFilterKey): UioUnit[] {
  const active = KEYS.filter((k) => k !== except && f[k].length > 0).map((k) => [k, new Set(f[k])] as const);
  if (active.length === 0) return units;
  return units.filter((u) => active.every(([k, s]) => s.has(uioValueOf(k, u, custType))));
}

/** Pilihan tiap filter: hanya nilai yang masih punya unit dengan filter lain yang aktif. */
export function uioFilterOptions(units: UioUnit[], f: UioFilterState, custType: Map<string, string>): Record<UioFilterKey, string[]> {
  const out = {} as Record<UioFilterKey, string[]>;
  KEYS.forEach((k) => {
    const set = new Set<string>();
    filterUioUnits(units, f, custType, k).forEach((u) => set.add(uioValueOf(k, u, custType)));
    let arr = Array.from(set);
    if (k === "yearBast") arr.sort();
    else if (k === "monthBast") arr.sort((a, b) => monthIndex(a) - monthIndex(b));
    else if (k === "custType") arr.sort((a, b) => kaRank(a) - kaRank(b) || a.localeCompare(b));
    else arr.sort((a, b) => a.localeCompare(b));
    // Pilihan yang sedang dipilih tetap tampil walau kosong.
    f[k].forEach((v) => !set.has(v) && arr.push(v));
    out[k] = arr;
  });
  return out;
}
