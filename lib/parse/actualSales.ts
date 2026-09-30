import * as XLSX from "@e965/xlsx";
import { ParseError } from "./xlsxHelpers";
import { MONTH_ORDER, type ActualSalesRow } from "@/lib/types";

function normKey(k: string): string {
  return String(k).trim().toLowerCase().replace(/[\s_]+/g, "");
}
function pick(norm: Record<string, unknown>, candidates: string[]): unknown {
  for (const c of candidates) {
    const v = norm[c];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

export type ActualSalesParseResult = {
  rows: ActualSalesRow[];
  skipped: number;
};

export function parseActualSalesWorkbook(wb: XLSX.WorkBook): ActualSalesParseResult {
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  if (rows.length === 0) throw new ParseError("File kosong atau tidak terbaca.");

  const parsed: ActualSalesRow[] = [];
  let skipped = 0;
  for (const r of rows) {
    const norm: Record<string, unknown> = {};
    Object.keys(r).forEach((k) => {
      norm[normKey(k)] = r[k];
    });
    const year = pick(norm, ["tahun", "year"]);
    const monthRaw = pick(norm, ["bulan", "month"]);
    const product = pick(norm, ["product", "produk", "brand"]);
    const actual = pick(norm, ["actualsales", "actual", "sales", "penjualan"]);
    const month = MONTH_ORDER.find(
      (m) => m.toLowerCase() === String(monthRaw || "").trim().toLowerCase()
    );
    if (!year || !month || !product || actual === null) {
      skipped++;
      continue;
    }
    parsed.push({
      year: Number(year),
      month,
      product: String(product).trim().toUpperCase(),
      actual_sales: Number(actual) || 0
    });
  }
  if (parsed.length === 0) {
    throw new ParseError(
      "Tidak ada baris valid. Pastikan kolom Tahun, Bulan (nama Indonesia), Product, dan Actual Sales terisi."
    );
  }
  return { rows: parsed, skipped };
}
