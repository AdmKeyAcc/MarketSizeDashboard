import * as XLSX from "@e965/xlsx";
import { ParseError } from "./xlsxHelpers";

/** Potongan otomatis untuk Data Harga Non Kontrak: harga tertera di file
 * dikurangi 50% => harga nett = 50% dari harga tertera. */
export const NON_CONTRACT_DISCOUNT = 0.5;

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
function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

/** Angka dari sel Excel/CSV. Mendukung "1500000", "1.500.000", "Rp 1.500.000,50", "1,500,000.50". */
export function parsePrice(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/rp/gi, "").replace(/\s/g, "");
  if (!s) return null;
  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) {
    // pemisah desimal = yang muncul paling akhir
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (hasDot && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function readRows(wb: XLSX.WorkBook): Record<string, unknown>[] {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  if (rows.length === 0) throw new ParseError("File kosong atau tidak terbaca.");
  return rows;
}
function normalize(r: Record<string, unknown>): Record<string, unknown> {
  const norm: Record<string, unknown> = {};
  Object.keys(r).forEach((k) => {
    norm[normKey(k)] = r[k];
  });
  return norm;
}

export type ContractPriceRow = {
  part_number: string;
  customer_group: string;
  price: number; // sudah nett
  customer_code: string;
  customer_name: string;
  customer_type: string;
};
export type ContractPriceParseResult = { rows: ContractPriceRow[]; skipped: number; duplicates: number };

/** Data Harga Kontrak (SCPL). Kolom: Cust. Code, Cust. Name, Cust. Group, Cust. Type,
 * Part Number, Harga. Harga sudah nett — dipakai apa adanya. Satu baris per
 * Part Number + Cust. Group (baris kembar: yang terakhir dipakai). */
export function parseContractPriceWorkbook(wb: XLSX.WorkBook): ContractPriceParseResult {
  const rows = readRows(wb);
  const map = new Map<string, ContractPriceRow>();
  let skipped = 0;
  let duplicates = 0;
  for (const r of rows) {
    const n = normalize(r);
    const partNumber = str(pick(n, ["partnumber", "nomorpart", "nopart"]));
    const group = str(pick(n, ["custgroup", "customergroup"]));
    const price = parsePrice(pick(n, ["harga", "price", "hargakontrak", "hargarupiah"]));
    // Harga kontrak selalu terkait Customer Group; tanpa group tidak bisa dipakai.
    if (!partNumber || !group || price === null) {
      skipped++;
      continue;
    }
    const key = `${partNumber}|${group}`;
    if (map.has(key)) duplicates++;
    map.set(key, {
      part_number: partNumber,
      customer_group: group,
      price,
      customer_code: str(pick(n, ["custcode", "customercode"])),
      customer_name: str(pick(n, ["custname", "customername"])),
      customer_type: str(pick(n, ["custtype", "customertype"]))
    });
  }
  if (map.size === 0) {
    throw new ParseError("Tidak ada baris valid. Pastikan kolom Part Number, Cust. Group, dan Harga terisi.");
  }
  return { rows: Array.from(map.values()), skipped, duplicates };
}

export type NonContractPriceRow = { part_number: string; list_price: number; price: number };
export type NonContractPriceParseResult = { rows: NonContractPriceRow[]; skipped: number; duplicates: number };

/** Data Harga Non Kontrak. Kolom: Part Number, Harga (harga tertera/pricelist).
 * Sistem otomatis mengurangi 50% -> harga nett. */
export function parseNonContractPriceWorkbook(wb: XLSX.WorkBook): NonContractPriceParseResult {
  const rows = readRows(wb);
  const map = new Map<string, NonContractPriceRow>();
  let skipped = 0;
  let duplicates = 0;
  for (const r of rows) {
    const n = normalize(r);
    const partNumber = str(pick(n, ["partnumber", "nomorpart", "nopart"]));
    const listPrice = parsePrice(pick(n, ["harga", "price", "pricelist", "hargatertera", "hargarupiah"]));
    if (!partNumber || listPrice === null) {
      skipped++;
      continue;
    }
    if (map.has(partNumber)) duplicates++;
    map.set(partNumber, {
      part_number: partNumber,
      list_price: listPrice,
      price: listPrice * (1 - NON_CONTRACT_DISCOUNT)
    });
  }
  if (map.size === 0) {
    throw new ParseError("Tidak ada baris valid. Pastikan kolom Part Number dan Harga terisi.");
  }
  return { rows: Array.from(map.values()), skipped, duplicates };
}
