import * as XLSX from "@e965/xlsx";

export class ParseError extends Error {}

export function findSheet(wb: XLSX.WorkBook, name: string): XLSX.WorkSheet {
  const key = wb.SheetNames.find(
    (k) => k.trim().toLowerCase() === name.trim().toLowerCase()
  );
  if (!key) {
    throw new ParseError(
      `Sheet '${name}' tidak ditemukan. Sheet yang ada: ${wb.SheetNames.join(", ")}`
    );
  }
  return wb.Sheets[key];
}

/**
 * Absolute A1-style cell access — row/col are 1-indexed, independent of the
 * sheet's populated range. Using XLSX.utils.sheet_to_json with header:1
 * instead is tempting, but its output array is indexed relative to the
 * sheet's *used range* (`!ref`), not to column A / row 1 — if a sheet's
 * data starts at column B (as the "Cust Data" sheet does), every column
 * silently shifts by one. Reading cells by absolute address avoids that.
 */
export function cellAt(ws: XLSX.WorkSheet, row: number, col: number): unknown {
  const addr = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
  const cell = ws[addr];
  if (!cell) return null;
  const v = (cell as XLSX.CellObject).v;
  return v === undefined ? null : v;
}

export function sheetLastRow(ws: XLSX.WorkSheet): number {
  const ref = ws["!ref"];
  if (!ref) return 200;
  return XLSX.utils.decode_range(ref).e.r + 1;
}

export function str(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  return String(v).trim();
}

export function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function readWorkbook(file: File): Promise<XLSX.WorkBook> {
  const buf = await file.arrayBuffer();
  return XLSX.read(buf, { type: "array" });
}
