/** Price Type harga part: Kontrak, SCPL, atau Non-Kontrak (harga umum). */
export type PriceType = "contract" | "scpl" | "non_contract";

export const PRICE_TYPES: PriceType[] = ["contract", "scpl", "non_contract"];
export const PRICE_TYPE_LABEL: Record<PriceType, string> = { contract: "Kontrak", scpl: "SCPL", non_contract: "Non-Kontrak" };
/** Pilihan dropdown di template Excel. */
export const UIO_PRICE_TYPE_OPTIONS = ["Kontrak", "SCPL", "Non-Kontrak"];
export const CONTRACT_PRICE_TYPE_OPTIONS = ["Kontrak", "SCPL"];

/** Teks dari file / database → Price Type. null = kosong / tidak dikenal. */
export function normPriceType(v: unknown): PriceType | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (!t) return null;
  if (t === "SCPL" || t === "SCL") return "scpl";
  if (t.startsWith("NON")) return "non_contract";
  if (t === "KONTRAK" || t === "CONTRACT" || t === "KONTRAKSCPL") return "contract";
  return null;
}

/** Price Type yang paling banyak dipakai unit-unit ini (null = tidak ada yang terisi). */
export function dominantPriceType(units: { price_type?: string | null }[]): PriceType | null {
  const n: Record<PriceType, number> = { contract: 0, scpl: 0, non_contract: 0 };
  let any = false;
  units.forEach((u) => {
    const t = normPriceType(u.price_type);
    if (t) {
      n[t]++;
      any = true;
    }
  });
  if (!any) return null;
  return PRICE_TYPES.reduce((best, t) => (n[t] > n[best] ? t : best), "contract" as PriceType);
}

type PriceRow = { part_number: string; customer_group: string | null; customer_code?: string | null; price: number; price_type?: string | null };
export type PriceHit = { price: number; source: PriceType | "pricelist"; group: string; code: string };

const up = (s: string | null | undefined) => (s || "").trim().toUpperCase();
/** Customer Code dinormalkan: huruf besar, tanpa spasi, angka "107195.0" → "107195". */
export const normCode = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const t = String(v).trim().toUpperCase().replace(/\s+/g, "");
  return /^\d+\.0+$/.test(t) ? t.replace(/\.0+$/, "") : t;
};
/** Jenis baris harga; baris lama tanpa price_type: ada Customer Group / Customer Code = Kontrak, kosong = Non-Kontrak. */
export const rowPriceType = (p: PriceRow): PriceType => {
  if (!up(p.customer_group) && !normCode(p.customer_code)) return "non_contract";
  const t = normPriceType(p.price_type);
  return t === "scpl" ? "scpl" : t === "non_contract" ? "non_contract" : "contract";
};

/**
 * Pencari harga satu part untuk satu customer. Status kontrak diambil dari kolom Price Type di Data UIO (`type`):
 *   1) Price Type Non-Kontrak → Harga Non Kontrak (harga tertera − 50%), harga kontrak TIDAK dicari.
 *   2) Price Type Kontrak / SCPL → harga di Data Harga Kontrak / SCPL lewat Customer Code (nett).
 *      Kontrak dan SCPL diperlakukan sama (SCPL dicari dulu bila Price Type SCPL).
 *      Customer Code tidak punya harga untuk part itu → Harga Non Kontrak.
 *   3) Price Type kosong (data lama) → seperti 2): ada harga Kontrak/SCPL untuk Customer Code-nya → dipakai,
 *      selain itu Harga Non Kontrak.
 *   4) Tidak ada harga sama sekali → `fallback` (Pricelist Master Part, biasanya 0).
 * Harga kontrak WAJIB punya Customer Code; baris kontrak tanpa Customer Code tidak dipakai.
 */
type Lookup = (partNumber: string | null, codes: string[] | null, fallback: number, type?: PriceType | null) => PriceHit;
const lookupCache = new WeakMap<PriceRow[], Lookup>();
export function makePriceLookup(priceList: PriceRow[]): Lookup {
  const cached = lookupCache.get(priceList);
  if (cached) return cached;
  const byCode = new Map<string, { price: number; group: string; code: string }>();
  const general = new Map<string, number>();
  priceList.forEach((p) => {
    const t = rowPriceType(p);
    if (t === "non_contract") {
      general.set(p.part_number, p.price);
      return;
    }
    const code = normCode(p.customer_code);
    if (!code) return;
    byCode.set(`${p.part_number}|${code}|${t}`, { price: p.price, group: (p.customer_group || "").trim(), code });
  });
  const fn: Lookup = (partNumber, codes, fallback, type = null) => {
    if (partNumber) {
      if (type !== "non_contract" && codes && codes.length > 0) {
        const order: PriceType[] = type === "scpl" ? ["scpl", "contract"] : ["contract", "scpl"];
        for (const c of codes) {
          const code = normCode(c);
          if (!code) continue;
          for (const t of order) {
            const hit = byCode.get(`${partNumber}|${code}|${t}`);
            if (hit) return { price: hit.price, source: t, group: hit.group, code: hit.code };
          }
        }
      }
      const gen = general.get(partNumber);
      if (gen !== undefined) return { price: gen, source: "non_contract", group: "", code: "" };
    }
    return { price: fallback, source: "pricelist", group: "", code: "" };
  };
  lookupCache.set(priceList, fn);
  return fn;
}

/** Customer Code yang punya harga Kontrak / SCPL → jenis harga yang dimilikinya. */
export function codesWithContract(priceList: PriceRow[]): Map<string, Set<PriceType>> {
  const m = new Map<string, Set<PriceType>>();
  priceList.forEach((p) => {
    const t = rowPriceType(p);
    const code = normCode(p.customer_code);
    if (t === "non_contract" || !code) return;
    let s = m.get(code);
    if (!s) m.set(code, (s = new Set()));
    s.add(t);
  });
  return m;
}

/** Customer Code unit-unit (unik, dinormalkan). */
export function codesOf(units: { customer_code?: string | null }[]): string[] {
  return Array.from(new Set(units.map((u) => normCode(u.customer_code)).filter(Boolean)));
}

/** Customer Group (ejaan di Data Harga) yang punya harga Kontrak/SCPL. Kunci = huruf besar. */
export function groupsWithGroupPrice(priceList: PriceRow[]): Map<string, string> {
  const m = new Map<string, string>();
  priceList.forEach((p) => {
    if (rowPriceType(p) !== "non_contract" && up(p.customer_group)) m.set(up(p.customer_group), (p.customer_group || "").trim());
  });
  return m;
}
