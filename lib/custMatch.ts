/**
 * Pencocokan customer antara Master Customer, Data UIO dan Actual Sales (web Sales).
 * Kunci dasar = Customer Group + Customer Name. Dua aturan tambahan supaya ejaan berbeda tidak memecah customer:
 *   1) Dalam Customer Group yang sama, nama perusahaan yang sama walau ditulis beda
 *      ("PT. ABC", "ABC, PT", "Abc PT") dianggap satu customer — termasuk nama yang terpotong di sistem sumber
 *      (≥ 30 huruf, mis. "PT. UNITED TRACTORS PANDU ENGINEERI" = "PT. UNITED TRACTORS PANDU ENGINEERING").
 *   2) Customer yang punya unit tapi tanpa Actual dipasangkan dengan customer yang punya Actual tapi tanpa unit
 *      kalau nama perusahaannya sama (Customer Group boleh beda) dan pasangannya hanya satu di tiap sisi.
 */
import { custKey } from "@/lib/calculations";
import { companyKey, TRUNC_MIN } from "@/lib/fuzzy";

/** Pemberi kunci customer: ejaan lain dari perusahaan yang sama (group sama) mendapat kunci ejaan pertama. */
export function makeCustKeyResolver(): (group: string | null | undefined, name: string | null | undefined) => { key: string; raw: string } {
  const canon = new Map<string, string>();
  // Nama terpotong: kunci perusahaan dikelompokkan per Customer Group + 12 huruf pertama, lalu dicek awalan.
  const P = 12;
  const buckets = new Map<string, { ck: string; long: boolean }[]>();
  return (group, name) => {
    const raw = custKey(group, name);
    const nm = String(name || "").trim();
    const g = String(group || "").trim().toUpperCase();
    const k = companyKey(nm) || nm.toUpperCase();
    const ck = `${g}|${k}`;
    const key = canon.get(ck);
    if (key !== undefined) return { key, raw };
    const long = nm.length >= TRUNC_MIN;
    const bk = `${g}|${k.slice(0, P)}`;
    let list = buckets.get(bk);
    if (k.length >= P && list) {
      const hit = list.filter((o) => {
        const ok = o.ck.slice(g.length + 1);
        return (long && ok.length > k.length && ok.startsWith(k)) || (o.long && ok.length < k.length && k.startsWith(ok));
      });
      if (hit.length === 1) {
        const kk = canon.get(hit[0].ck)!;
        canon.set(ck, kk);
        return { key: kk, raw };
      }
    }
    canon.set(ck, raw);
    if (k.length >= P) {
      if (!list) buckets.set(bk, (list = []));
      list.push({ ck, long });
    }
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
