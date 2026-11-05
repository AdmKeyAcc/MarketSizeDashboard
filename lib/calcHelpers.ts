import type { PriceListEntry } from "@/lib/types";
import { makePriceLookup, type PriceType } from "@/lib/priceType";


export type PriceSource = "contract" | "scpl" | "non_contract" | "pricelist";
export type PriceInfo = { price: number; source: PriceSource; label: string };

/** Harga yang dipakai Market Size (sama persis dengan buildPriceResolver di perhitungan Dashboard). */
export function resolvePriceInfo(priceList: PriceListEntry[], partNumber: string | null, codes: string[] | null, pricelist: number, priceType: PriceType | null = null): PriceInfo {
  const hit = makePriceLookup(priceList)(partNumber, codes, pricelist, priceType);
  const label =
    hit.source === "contract" ? `Harga Kontrak ${hit.group || hit.code}` : hit.source === "scpl" ? `Harga SCPL ${hit.group || hit.code}` : hit.source === "non_contract" ? "Harga Non Kontrak" : "Pricelist Master Part";
  return { price: hit.price, source: hit.source, label };
}
