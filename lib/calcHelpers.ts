import type { PriceListEntry } from "@/lib/types";

const up = (s: string | null | undefined) => (s || "").trim().toUpperCase();

export type PriceSource = "contract" | "non_contract" | "pricelist";
export type PriceInfo = { price: number; source: PriceSource; label: string };

/** Harga yang dipakai Market Size: harga kontrak untuk Customer Group tsb, kalau tidak ada Harga Non Kontrak per Part Number,
 * kalau tidak ada juga: Pricelist di Master Part. Sama persis dengan buildPriceResolver di perhitungan Dashboard. */
export function resolvePriceInfo(priceList: PriceListEntry[], partNumber: string | null, group: string, pricelist: number): PriceInfo {
  if (partNumber) {
    const pn = partNumber;
    const g = up(group);
    if (g) {
      const hit = priceList.find((p) => p.part_number === pn && up(p.customer_group) === g);
      if (hit) return { price: hit.price, source: "contract", label: `Harga kontrak ${hit.customer_group}` };
    }
    const gen = priceList.find((p) => p.part_number === pn && !(p.customer_group || "").trim());
    if (gen) return { price: gen.price, source: "non_contract", label: "Harga Non Kontrak" };
  }
  return { price: pricelist, source: "pricelist", label: "Pricelist Master Part" };
}
