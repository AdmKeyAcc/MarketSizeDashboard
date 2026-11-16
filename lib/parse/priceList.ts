import * as XLSX from "@e965/xlsx";
import { ParseError } from "./xlsxHelpers";
import { normCode, normPriceType } from "@/lib/priceType";

/** Potongan bawaan untuk Data Harga Non Kontrak (harga nett = 50% dari harga tertera).
 * Nilai yang dipakai sungguhan dibaca dari tabel `app_settings` (key non_contract_discount). */
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

/** Kolom tanggal berlaku harga (opsional). Kalau satu harga muncul beberapa kali, yang tanggal berlakunya paling baru yang dipakai. */
export const PRICE_DATE_COLS = ["tanggalberlaku", "tglberlaku", "berlakumulai", "berlaku", "validfrom", "effectivedate", "tanggal", "date"];

/** Tanggal dari sel Excel/CSV → milidetik (UTC); null bila kosong / tidak terbaca.
 * Diterima: tanggal Excel, nomor seri tanggal Excel, "dd/mm/yyyy", "dd-mm-yyyy", "yyyy-mm-dd". */
export function parseDateCell(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === "number") return v > 20000 && v < 80000 ? Math.round((v - 25569) * 86400000) : null;
  const t = String(v).trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(t);
  if (m) return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return null;
}

/** Baris kembar dengan kunci sama: true = baris baru menggantikan yang lama (tanggal berlaku lebih baru, atau tanpa tanggal → baris paling bawah). */
export function newerPrice(prevDate: number | null | undefined, date: number | null): boolean {
  if (prevDate === null || prevDate === undefined || date === null) return true;
  return date >= prevDate;
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
  /** Kontrak atau SCPL (kolom Price Type; kosong = Kontrak). */
  price_type: "contract" | "scpl";
};
export type ContractPriceParseResult = { rows: ContractPriceRow[]; skipped: number; duplicates: number; nonContractRows: number; noCode: number };

/** Data Harga Kontrak / SCPL. Kolom: Cust. Code (WAJIB), Cust. Name, Cust. Group, Cust. Type,
 * Price Type (Kontrak / SCPL; kosong = Kontrak), Part Number, Harga. Harga sudah nett — dipakai apa adanya.
 * Satu baris per Part Number + Cust. Code + Price Type (baris kembar: tanggal berlaku terbaru; tanpa tanggal: baris paling bawah).
 * Baris ber-Price Type Non-Kontrak dilewati (harga non kontrak di-upload di slot sendiri). */
export function parseContractPriceWorkbook(wb: XLSX.WorkBook): ContractPriceParseResult {
  const rows = readRows(wb);
  const map = new Map<string, ContractPriceRow>();
  const dateOf = new Map<string, number | null>();
  let skipped = 0;
  let duplicates = 0;
  let nonContractRows = 0;
  let noCode = 0;
  for (const r of rows) {
    const n = normalize(r);
    const pt = normPriceType(pick(n, ["pricetype", "tipeharga", "jenisharga"]));
    if (pt === "non_contract") {
      nonContractRows++;
      skipped++;
      continue;
    }
    const priceType: "contract" | "scpl" = pt === "scpl" ? "scpl" : "contract";
    const partNumber = str(pick(n, ["partnumber", "nomorpart", "nopart"]));
    const group = str(pick(n, ["custgroup", "customergroup"]));
    const price = parsePrice(pick(n, ["harga", "price", "hargakontrak", "hargarupiah"]));
    // Harga kontrak selalu terkait Customer Group; tanpa group tidak bisa dipakai.
    const code = normCode(pick(n, ["custcode", "customercode", "kodecustomer", "soldto", "soldtoparty"]));
    // Harga kontrak WAJIB punya Customer Code (kunci pencocokan ke customer di Data UIO).
    if (partNumber && price !== null && !code) {
      noCode++;
      skipped++;
      continue;
    }
    if (!partNumber || !code || price === null) {
      skipped++;
      continue;
    }
    const key = `${partNumber}|${code}|${priceType}`;
    const date = parseDateCell(pick(n, PRICE_DATE_COLS));
    if (map.has(key)) {
      duplicates++;
      if (!newerPrice(dateOf.get(key), date)) continue; // baris lama punya tanggal berlaku lebih baru
    }
    dateOf.set(key, date);
    map.set(key, {
      part_number: partNumber,
      customer_group: group,
      price_type: priceType,
      price,
      customer_code: code,
      customer_name: str(pick(n, ["custname", "customername"])),
      customer_type: str(pick(n, ["custtype", "customertype"]))
    });
  }
  if (map.size === 0) {
    throw new ParseError(
      noCode > 0
        ? `Tidak ada baris valid: ${noCode} baris tanpa Cust. Code. Harga kontrak / SCPL wajib punya Customer Code (kode Sold-to).`
        : "Tidak ada baris valid. Pastikan kolom Cust. Code, Part Number, dan Harga terisi."
    );
  }
  return { rows: Array.from(map.values()), skipped, duplicates, nonContractRows, noCode };
}

export type NonContractPriceRow = { part_number: string; list_price: number; price: number };
export type NonContractPriceParseResult = { rows: NonContractPriceRow[]; skipped: number; duplicates: number };

/** Data Harga Non Kontrak. Kolom: Part Number, Harga (harga tertera/pricelist).
 * Sistem otomatis memotong `discount` (bawaan 50%) -> harga nett. */
export function parseNonContractPriceWorkbook(wb: XLSX.WorkBook, discount: number = NON_CONTRACT_DISCOUNT): NonContractPriceParseResult {
  const rows = readRows(wb);
  const map = new Map<string, NonContractPriceRow>();
  const dateOf = new Map<string, number | null>();
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
    const date = parseDateCell(pick(n, PRICE_DATE_COLS));
    if (map.has(partNumber)) {
      duplicates++;
      if (!newerPrice(dateOf.get(partNumber), date)) continue;
    }
    dateOf.set(partNumber, date);
    map.set(partNumber, {
      part_number: partNumber,
      list_price: listPrice,
      price: listPrice * (1 - discount)
    });
  }
  if (map.size === 0) {
    throw new ParseError("Tidak ada baris valid. Pastikan kolom Part Number dan Harga terisi.");
  }
  return { rows: Array.from(map.values()), skipped, duplicates };
}
