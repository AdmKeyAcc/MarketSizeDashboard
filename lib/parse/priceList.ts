import * as XLSX from "@e965/xlsx";
import { ParseError } from "./xlsxHelpers";
import type { PriceListEntry } from "@/lib/types";

function normKey(k: string): string {
  return String(k).trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function pick(norm: Record<string, unknown>, candidates: string[]): unknown {
  for (const c of candidates) {
    const v = norm[c];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

export type PriceListParseResult = {
  rows: PriceListEntry[];
  skipped: number;
};

/**
 * "Data Harga" — pricelist per Part Number, opsional beda per Customer
 * Group (kontrak harga khusus). Kolom Customer Group boleh kosong: itu
 * berarti harga default/nasional untuk part tsb (disimpan sebagai string
 * kosong, bukan null, supaya konsisten sebagai satu baris "default" per
 * part number).
 */
export function parsePriceListWorkbook(wb: XLSX.WorkBook): PriceListParseResult {
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  if (rows.length === 0) throw new ParseError("File kosong atau tidak terbaca.");

  const parsed: PriceListEntry[] = [];
  let skipped = 0;
  for (const r of rows) {
    const norm: Record<string, unknown> = {};
    Object.keys(r).forEach((k) => {
      norm[normKey(k)] = r[k];
    });
    const partNumber = pick(norm, ["partnumber", "nomorpart", "nopart"]);
    const custGroup = pick(norm, ["customergroup", "custgroup"]);
    const price = pick(norm, ["harga", "price", "pricelist", "hargarupiah"]);

    if (!partNumber || price === null) {
      skipped++;
      continue;
    }

    parsed.push({
      part_number: String(partNumber).trim(),
      customer_group: custGroup ? String(custGroup).trim() : "",
      price: Number(price) || 0
    });
  }

  if (parsed.length === 0) {
    throw new ParseError(
      "Tidak ada baris valid. Pastikan kolom Part Number dan Harga terisi (kolom Customer Group boleh kosong " +
        "— berarti harga default untuk semua customer)."
    );
  }
  return { rows: parsed, skipped };
}
