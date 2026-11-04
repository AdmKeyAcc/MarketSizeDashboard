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

type PriceRow = { part_number: string; customer_group: string | null; price: number; price_type?: string | null };
export type PriceHit = { price: number; source: PriceType | "pricelist"; group: string };

const up = (s: string | null | undefined) => (s || "").trim().toUpperCase();
/** Jenis baris harga; baris lama tanpa price_type: ada Customer Group = Kontrak, kosong = Non-Kontrak. */
export const rowPriceType = (p: PriceRow): PriceType => {
  if (!up(p.customer_group)) return "non_contract";
  const t = normPriceType(p.price_type);
  return t === "scpl" ? "scpl" : "contract";
};

/**
 * Pencari harga satu part untuk satu customer. Kontrak dan SCPL DIPERLAKUKAN SAMA (sama-sama harga khusus Customer Group);
 * Price Type-nya hanya label yang tetap dibedakan:
 *   Price Type Kontrak     → harga Kontrak Customer Group-nya, kalau tidak ada harga SCPL-nya, kalau tidak ada → Harga Non Kontrak;
 *   Price Type SCPL        → harga SCPL Customer Group-nya, kalau tidak ada harga Kontrak-nya, kalau tidak ada → Harga Non Kontrak;
 *   Price Type Non-Kontrak → Harga Non Kontrak;
 *   Price Type kosong      → sama seperti Kontrak (aturan lama).
 * Kalau Harga Non Kontrak juga tidak ada → `fallback` (Pricelist Master Part, biasanya 0).
 */
export function makePriceLookup(priceList: PriceRow[]) {
  const byGroup = new Map<string, { price: number; group: string }>();
  const general = new Map<string, number>();
  priceList.forEach((p) => {
    const t = rowPriceType(p);
    if (t === "non_contract") general.set(p.part_number, p.price);
    else byGroup.set(`${p.part_number}|${up(p.customer_group)}|${t}`, { price: p.price, group: (p.customer_group || "").trim() });
  });
  return (partNumber: string | null, customerGroup: string | null, fallback: number, type: PriceType | null = null): PriceHit => {
    if (partNumber) {
      const g = up(customerGroup);
      if (g && type !== "non_contract") {
        const order: PriceType[] = type === "scpl" ? ["scpl", "contract"] : ["contract", "scpl"];
        for (const t of order) {
          const hit = byGroup.get(`${partNumber}|${g}|${t}`);
          if (hit) return { price: hit.price, source: t, group: hit.group };
        }
      }
      const gen = general.get(partNumber);
      if (gen !== undefined) return { price: gen, source: "non_contract", group: "" };
    }
    return { price: fallback, source: "pricelist", group: "" };
  };
}

/** Customer Group (ejaan di Data Harga) yang punya harga Kontrak/SCPL. Kunci = huruf besar. */
export function groupsWithGroupPrice(priceList: PriceRow[]): Map<string, string> {
  const m = new Map<string, string>();
  priceList.forEach((p) => {
    if (rowPriceType(p) !== "non_contract") m.set(up(p.customer_group), (p.customer_group || "").trim());
  });
  return m;
}
