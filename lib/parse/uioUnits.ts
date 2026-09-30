import * as XLSX from "@e965/xlsx";
import { ParseError } from "./xlsxHelpers";

/** One row of raw output from the parser — the API route turns this into a
 * uio_units row (adding the dedupe_key, since that needs upload-time logic
 * to fall back safely when Serial Number is missing/placeholder). */
export type UioUnitParsed = {
  year: number | null;
  product: string | null;
  model: string | null;
  customer_group: string | null;
  customer_name: string | null;
  branch: string | null;
  serial_number: string | null;
  engine_serial_number: string | null;
};

export type UioUnitsParseResult = {
  rows: UioUnitParsed[];
  skipped: number;
  sheetName: string;
};

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
function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * Real-world "Data UIO" exports (population/UIO-confirmation reports) vary
 * a lot in column naming from one branch/report to another — this is why
 * matching is by normalized header name across a generous candidate list,
 * the same approach as parseActualSalesWorkbook, rather than fixed A1
 * coordinates like the Kalkulator/Customer parsers use.
 *
 * Picks the sheet with the most data rows among all sheets in the
 * workbook (a file can carry several tabs, e.g. "Confirmation UIO" +
 * "Populasi All Branch" — the population tab is normally the bigger one
 * and the one meant for upload).
 */
export function parseUioUnitsWorkbook(wb: XLSX.WorkBook): UioUnitsParseResult {
  let best: { name: string; rows: Record<string, unknown>[] } | null = null;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
    if (!best || rows.length > best.rows.length) best = { name, rows };
  }
  if (!best || best.rows.length === 0) {
    throw new ParseError("File kosong atau tidak terbaca.");
  }

  const parsed: UioUnitParsed[] = [];
  let skipped = 0;
  for (const r of best.rows) {
    const norm: Record<string, unknown> = {};
    Object.keys(r).forEach((k) => {
      norm[normKey(k)] = r[k];
    });

    const year = pick(norm, ["tahun", "year", "yearinv", "tahuninv"]);
    const product = pick(norm, ["product", "produk", "brand", "productdescription"]);
    const model = pick(norm, ["model", "modelunit", "modeldescription"]);
    const custGroup = pick(norm, ["custgroup", "customergroup"]);
    const custName = pick(norm, [
      "customername", "custname", "name1", "newcustomername", "cn"
    ]);
    const branch = pick(norm, [
      "branch", "cabang", "soff", "salesoffice", "branchuioconfirm", "branchuioconfirmation"
    ]);
    const serial = pick(norm, [
      "serialnumber", "unitserialnumber", "serialnumberunit", "nomorseri"
    ]);
    const engineSerial = pick(norm, [
      "engineserialnumber", "engineserialnumbertr", "engineno", "engineno"
    ]);

    // A row needs at minimum a Product so it means something as a unit —
    // everything else can be missing and the row is still kept (Year and
    // Customer Group missing just means it won't count toward per-year or
    // per-customer-group breakdowns).
    if (!product) {
      skipped++;
      continue;
    }

    const yearNum = year !== null ? Number(year) : NaN;
    parsed.push({
      year: Number.isFinite(yearNum) ? yearNum : null,
      product: str(product)?.toUpperCase() ?? null,
      model: str(model),
      customer_group: str(custGroup),
      customer_name: str(custName),
      branch: str(branch),
      serial_number: str(serial),
      engine_serial_number: str(engineSerial)
    });
  }

  if (parsed.length === 0) {
    throw new ParseError(
      "Tidak ada baris valid. Pastikan ada kolom Product (nama brand) yang terisi — kolom lain (Tahun, Model, " +
        "Customer Group, Branch, Serial Number) boleh sebagian kosong."
    );
  }
  return { rows: parsed, skipped, sheetName: best.name };
}
