import { addUnitHm, canonicalProduct, defaultWorkdaysOf, emptyUnitHm, normModel, type UnitHm, type WorkdaysOf } from "@/lib/calculations";
import type { PriceListEntry, UioUnit } from "@/lib/types";

const up = (s: string | null | undefined) => (s || "").trim().toUpperCase();

/** UIO satu part pada tahun tertentu — aturan yang sama dengan tabel Detail part di Summary & Market Size di Dashboard:
 * unit dengan Year Inv ≤ tahun (unit tanpa tahun ikut), Product sama (kanonik), Model sama (dinormalisasi);
 * kalau tidak ada yang persis sama, model part boleh berupa awalan model unit (mis. part "1103" → unit "1103A-33G").
 * Opsional dibatasi ke satu Customer Group / satu Customer. */
export function uioCountForPart(
  units: UioUnit[],
  year: number | null,
  product: string,
  partModel: string,
  group?: string,
  name?: string
): number {
  return uioHoursForPart(units, year, product, partModel, group, name).units;
}

/** Sama seperti uioCountForPart, tapi mengembalikan juga ringkasan jam operasi unit-unit tsb
 * (HM/Day × Day/Month × Month/Year dari Data UIO) — dasar Annual HM. */
export function uioHoursForPart(
  units: UioUnit[],
  year: number | null,
  product: string,
  partModel: string,
  group?: string,
  name?: string,
  workdaysOf: WorkdaysOf = defaultWorkdaysOf
): UnitHm {
  const prod = canonicalProduct(product);
  const pm = normModel(partModel);
  const g = up(group);
  const n = up(name);
  const exact = emptyUnitHm();
  const prefix = emptyUnitHm();
  units.forEach((u) => {
    if (canonicalProduct(u.product) !== prod) return;
    if (year !== null && u.year !== null && u.year > year) return;
    if (g && up(u.customer_group) !== g) return;
    if (n && up(u.customer_name) !== n) return;
    const nm = normModel(u.model);
    if (nm === pm) addUnitHm(exact, u, workdaysOf);
    else if (pm.length >= 3 && nm.startsWith(pm)) addUnitHm(prefix, u, workdaysOf);
  });
  return exact.units > 0 ? exact : prefix;
}

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
