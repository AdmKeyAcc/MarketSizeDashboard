/**
 * Pencocokan customer antara Master Customer, Data UIO dan Actual Sales (web Sales).
 * Kunci dasar = Customer Group + Customer Name. Dua aturan tambahan supaya ejaan berbeda tidak memecah customer:
 *   1) Dalam Customer Group yang sama, nama perusahaan yang sama walau ditulis beda
 *      ("PT. ABC", "ABC, PT", "Abc PT") dianggap satu customer.
 *   2) Customer yang punya unit tapi tanpa Actual dipasangkan dengan customer yang punya Actual tapi tanpa unit
 *      kalau nama perusahaannya sama (Customer Group boleh beda) dan pasangannya hanya satu di tiap sisi.
 */
import { custKey } from "@/lib/calculations";
import { companyKey } from "@/lib/fuzzy";

/** Pemberi kunci customer: ejaan lain dari perusahaan yang sama (group sama) mendapat kunci ejaan pertama. */
export function makeCustKeyResolver(): (group: string | null | undefined, name: string | null | undefined) => { key: string; raw: string } {
  const canon = new Map<string, string>();
  return (group, name) => {
    const raw = custKey(group, name);
    const nm = String(name || "").trim();
    const ck = `${String(group || "").trim().toUpperCase()}|${companyKey(nm) || nm.toUpperCase()}`;
    const key = canon.get(ck);
    if (key !== undefined) return { key, raw };
    canon.set(ck, raw);
    return { key: raw, raw };
  };
}

/** Pasangan (punya unit, tanpa Actual) ↔ (punya Actual, tanpa unit) dengan nama perusahaan sama dan unik di tiap sisi. */
export function pairUnitAndActual<T>(items: T[], nameOf: (t: T) => string, hasUnits: (t: T) => boolean, hasActual: (t: T) => boolean): [T, T][] {
  const u = new Map<string, T[]>();
  const a = new Map<string, T[]>();
  items.forEach((t) => {
    const k = companyKey(nameOf(t));
    if (!k) return;
    const hu = hasUnits(t), ha = hasActual(t);
    const side = hu && !ha ? u : !hu && ha ? a : null;
    if (!side) return;
    const arr = side.get(k);
    if (arr) arr.push(t);
    else side.set(k, [t]);
  });
  const out: [T, T][] = [];
  u.forEach((us, k) => {
    const as = a.get(k);
    if (us.length === 1 && as && as.length === 1) out.push([us[0], as[0]]);
  });
  return out;
}
