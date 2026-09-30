import * as XLSX from "@e965/xlsx";
import { cellAt, findSheet, sheetLastRow, str, num, ParseError } from "./xlsxHelpers";
import type { Part, UioMaster, Assumption } from "@/lib/types";

export type KalkulatorParseResult = {
  parts: Part[];
  uio: UioMaster[];
  assumptions: Assumption[];
};

export function parseKalkulatorWorkbook(wb: XLSX.WorkBook): KalkulatorParseResult {
  const ws = findSheet(wb, "Data input 1");

  const hdrCheck = String(cellAt(ws, 8, 8) || "").toUpperCase();
  if (!hdrCheck.includes("MODEL")) {
    throw new ParseError(
      "Struktur sheet tidak sesuai (header 'MODEL UNIT' tidak ditemukan di baris 8 kolom H)."
    );
  }

  const uio: UioMaster[] = [];
  const lastRowUio = Math.max(sheetLastRow(ws), 100);
  for (let row = 11; row <= lastRowUio; row++) {
    const product = cellAt(ws, row, 2);
    const model = cellAt(ws, row, 3);
    if (product === null && model === null) continue;
    uio.push({
      product: str(product) || "",
      model: str(model) || "",
      hm_day: num(cellAt(ws, row, 4)),
      uio_qty: num(cellAt(ws, row, 5))
    });
  }

  const parts: Part[] = [];
  const lastRowParts = Math.max(sheetLastRow(ws), 533);
  for (let row = 9; row <= lastRowParts; row++) {
    const product = cellAt(ws, row, 7);
    if (product === null) continue;
    parts.push({
      product: str(product) || "",
      model: str(cellAt(ws, row, 8)) || "",
      component: str(cellAt(ws, row, 9)),
      part_name: str(cellAt(ws, row, 10)) || "",
      part_number: str(cellAt(ws, row, 11)),
      old_part_number: str(cellAt(ws, row, 12)),
      qty_per_unit: num(cellAt(ws, row, 13)),
      pricelist: num(cellAt(ws, row, 14)),
      freq_replacement_hm: num(cellAt(ws, row, 15)),
      hm_day: num(cellAt(ws, row, 16)),
      annual_hm: num(cellAt(ws, row, 17)),
      uio_qty: num(cellAt(ws, row, 18)),
      qty_market_size: num(cellAt(ws, row, 19)),
      contract_price: num(cellAt(ws, row, 20)),
      amount_market_size: num(cellAt(ws, row, 21))
    });
  }
  if (parts.length === 0) {
    throw new ParseError("Tidak ada baris part yang terbaca dari kolom G–U.");
  }

  const assumptions: Assumption[] = [];
  for (let col = 1; col <= 40; col += 2) {
    const brand = cellAt(ws, 3, col);
    if (!brand) continue;
    const discountRaw = cellAt(ws, 6, col + 1);
    assumptions.push({
      product: str(brand) || "",
      workdays_month: num(cellAt(ws, 4, col + 1)) || 22,
      discount: discountRaw === null || Number.isNaN(Number(discountRaw)) ? 0.5 : num(discountRaw)
    });
  }

  return { parts, uio, assumptions };
}
