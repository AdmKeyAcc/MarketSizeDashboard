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
  pss_name: string | null;
  customer_code: string | null;
  customer_type: string | null;
  hm_day: number | null;
  day_month: number | null;
  month_year: number | null;
};

export type UioUnitsParseResult = {
  rows: UioUnitParsed[];
  skipped: number;
  /** Baris retur/pembatalan (Invoiced Quantity negatif) yang dibuang. */
  returns: number;
  /** Baris dengan tahun di bawah batas awal (minYear) yang dibuang. */
  beforeMinYear: number;
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
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
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
export function parseUioUnitsWorkbook(wb: XLSX.WorkBook, opts: { minYear?: number } = {}): UioUnitsParseResult {
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
  let returns = 0;
  let beforeMinYear = 0;
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
      "branchuioconfirm", "branchuioconfirmation", "branch", "cabang", "soff", "salesoffice"
    ]);
    const serial = pick(norm, [
      "serialnumber", "unitserialnumber", "serialnumberunit", "nomorseri"
    ]);
    const pssName = pick(norm, ["pssname", "pss"]);
    const custCode = pick(norm, ["custcode", "customercode", "kodecustomer"]);
    const custType = pick(norm, ["custtype", "customertype", "tipecustomer"]);
    const hmDay = pick(norm, ["hmday", "hmperhari"]);
    const dayMonth = pick(norm, ["daymonth", "harikerjabulan", "dayspermonth"]);
    const monthYear = pick(norm, ["monthyear", "bulantahun", "monthsperyear"]);
    const qty = num(pick(norm, ["invoicedquantity", "invoicedqty"]));

    // A row needs at minimum a Product so it means something as a unit —
    // everything else can be missing and the row is still kept (Year and
    // Customer Group missing just means it won't count toward per-year or
    // per-customer-group breakdowns).
    if (!product) {
      skipped++;
      continue;
    }
    // Invoiced Quantity negatif = retur/pembatalan, bukan unit yang beroperasi.
    if (qty !== null && qty < 0) {
      returns++;
      continue;
    }

    const yearNum = year !== null ? Number(year) : NaN;
    if (opts.minYear !== undefined && Number.isFinite(yearNum) && yearNum < opts.minYear) {
      beforeMinYear++;
      continue;
    }
    parsed.push({
      year: Number.isFinite(yearNum) ? yearNum : null,
      product: str(product)?.toUpperCase() ?? null,
      model: str(model),
      customer_group: str(custGroup),
      customer_name: str(custName),
      branch: str(branch),
      serial_number: str(serial),
      pss_name: str(pssName),
      customer_code: str(custCode),
      customer_type: str(custType),
      hm_day: num(hmDay),
      day_month: num(dayMonth),
      month_year: num(monthYear)
    });
  }

  if (parsed.length === 0) {
    throw new ParseError(
      "Tidak ada baris valid. Pastikan ada kolom Product (nama brand) yang terisi — kolom lain (Tahun, Model, " +
        "Customer Group, Branch, Serial Number) boleh sebagian kosong."
    );
  }
  return { rows: parsed, skipped, returns, beforeMinYear, sheetName: best.name };
}

/* ------------------------------------------------------------------ */
/* Penyamaan nama customer dengan daftar customer resmi                */
/* ------------------------------------------------------------------ */

/** Nama customer dinormalkan (huruf besar, tanpa PT/CV/TBK, tanda baca, spasi ganda)
 * supaya "HI-TECH INK INDONESIA, PT" dan "PT. HI TECH INK INDONESIA" dianggap sama. */
export function normCustName(s: string | null | undefined): string {
  return String(s || "")
    .toUpperCase()
    .replace(/[.,()\-]/g, " ")
    .replace(/\b(PT|CV|TBK|UD|PD)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type CanonPair = { customer_group: string | null; customer_name: string | null };

/** Samakan Customer Group + Customer Name unit dengan daftar resmi (Master Customer / laporan Actual Sales):
 *  1) pasangan group|nama sudah persis sama → tidak diubah;
 *  2) nama (dinormalkan) cocok dengan tepat satu customer resmi → pakai group & nama resmi;
 *  3) selain itu dibiarkan seperti di file. */
export function canonicalizeUnits(rows: UioUnitParsed[], canon: CanonPair[]): { rows: UioUnitParsed[]; exact: number; remapped: number; unmatched: number } {
  const exactSet = new Set<string>();
  const byNorm = new Map<string, { g: string; n: string } | null>();
  canon.forEach((c) => {
    const g = (c.customer_group || "").trim();
    const n = (c.customer_name || "").trim();
    if (!n) return;
    exactSet.add(`${g.toUpperCase()}|${n.toUpperCase()}`);
    const k = normCustName(n);
    if (!k) return;
    const prev = byNorm.get(k);
    if (prev === undefined) byNorm.set(k, { g, n });
    else if (prev && (prev.g.toUpperCase() !== g.toUpperCase() || prev.n.toUpperCase() !== n.toUpperCase())) byNorm.set(k, null); // ambigu
  });
  let exact = 0, remapped = 0, unmatched = 0;
  const out = rows.map((r) => {
    const g = (r.customer_group || "").trim();
    const n = (r.customer_name || "").trim();
    if (!n) { unmatched++; return r; }
    if (exactSet.has(`${g.toUpperCase()}|${n.toUpperCase()}`)) { exact++; return r; }
    const hit = byNorm.get(normCustName(n));
    if (hit) { remapped++; return { ...r, customer_group: hit.g, customer_name: hit.n }; }
    unmatched++;
    return r;
  });
  return { rows: out, exact, remapped, unmatched };
}
