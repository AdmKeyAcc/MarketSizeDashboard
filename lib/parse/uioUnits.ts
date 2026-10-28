import * as XLSX from "@e965/xlsx";
import { ParseError } from "./xlsxHelpers";

/** One row of raw output from the parser — the API route turns this into a
 * uio_units row (adding the dedupe_key, since that needs upload-time logic
 * to fall back safely when Serial Number is missing/placeholder). */
export type UioUnitParsed = {
  /** Year Inv — tahun invoice/pembelian unit. */
  year: number | null;
  /** Month Inv — bulan invoice/pembelian (1–12). Kosong = dianggap beroperasi setahun penuh di tahun belinya. */
  month_inv: number | null;
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
  /** Hasil pemeriksaan isi file — ditampilkan sebelum data disimpan. */
  validation: UioValidation;
};

/** Satu jenis masalah pada file Data UIO: berapa baris dan contoh nomor barisnya (nomor baris Excel). */
export type UioIssue = {
  field: string;
  /** "penting" = memengaruhi Market Size/pencocokan; "info" = dipakai nilai default. */
  level: "penting" | "info";
  message: string;
  count: number;
  rows: number[];
};
export type UioValidation = {
  totalRows: number;
  /** Kolom yang tidak ditemukan sama sekali di baris judul. */
  missingColumns: string[];
  issues: UioIssue[];
};

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, peb: 2, mar: 3, maret: 3, march: 3,
  apr: 4, april: 4, mei: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7,
  agu: 8, agt: 8, ags: 8, agustus: 8, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, nopember: 11, november: 11,
  des: 12, desember: 12, dec: 12, december: 12
};

/** Bulan dari angka (1–12) atau nama bulan (Indonesia/Inggris, lengkap atau singkat). null = kosong/tidak valid. */
export function parseMonth(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isInteger(v) && v >= 1 && v <= 12 ? v : null;
  const t = String(v).trim().toLowerCase().replace(/\.$/, "");
  if (/^\d{1,2}$/.test(t)) {
    const n = Number(t);
    return n >= 1 && n <= 12 ? n : null;
  }
  return MONTHS[t] ?? null;
}

const COLS = {
  year: ["yearinv", "tahuninv", "yearinvoice", "tahuninvoice", "tahun", "year"],
  month: ["monthinv", "bulaninv", "monthinvoice", "bulaninvoice", "invmonth"],
  product: ["product", "produk", "brand", "productdescription"],
  model: ["model", "modelunit", "modeldescription"],
  custGroup: ["custgroup", "customergroup"],
  custName: ["customername", "custname", "name1", "newcustomername", "cn"],
  branch: ["branchuioconfirm", "branchuioconfirmation", "branch", "cabang", "soff", "salesoffice"],
  serial: ["serialnumber", "unitserialnumber", "serialnumberunit", "nomorseri"],
  hmDay: ["hmday", "hmperhari"],
  dayMonth: ["daymonth", "harikerjabulan", "dayspermonth"],
  monthYear: ["monthyear", "bulantahun", "monthsperyear"]
};
const COL_LABEL: Record<keyof typeof COLS, string> = {
  year: "Year Inv", month: "Month Inv", product: "Product", model: "Model", custGroup: "Cust. Group",
  custName: "Cust. Name", branch: "Branch", serial: "Serial Number", hmDay: "HM/Day", dayMonth: "Day/Month",
  monthYear: "Month/Year"
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

  // ---- pemeriksaan isi file (ditampilkan ke pengguna sebelum disimpan) ----
  const headerKeys = new Set<string>();
  best.rows.slice(0, 50).forEach((r) => Object.keys(r).forEach((k) => headerKeys.add(normKey(k))));
  const missingColumns = (Object.keys(COLS) as (keyof typeof COLS)[])
    .filter((f) => !COLS[f].some((c) => headerKeys.has(c)))
    .map((f) => COL_LABEL[f]);
  const issueMap = new Map<string, UioIssue>();
  const flag = (key: string, field: string, level: UioIssue["level"], message: string, row: number) => {
    let it = issueMap.get(key);
    if (!it) issueMap.set(key, (it = { field, level, message, count: 0, rows: [] }));
    it.count++;
    if (it.rows.length < 15) it.rows.push(row);
  };
  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth() + 1;
  const has = (f: keyof typeof COLS) => !missingColumns.includes(COL_LABEL[f]);

  best.rows.forEach((r, i) => {
    const rowNo = i + 2; // nomor baris di Excel (baris 1 = judul kolom)
    const norm: Record<string, unknown> = {};
    Object.keys(r).forEach((k) => {
      norm[normKey(k)] = r[k];
    });

    const yearRaw = pick(norm, COLS.year);
    const monthRaw = pick(norm, COLS.month);
    const product = pick(norm, COLS.product);
    const model = pick(norm, COLS.model);
    const custGroup = pick(norm, COLS.custGroup);
    const custName = pick(norm, COLS.custName);
    const branch = pick(norm, COLS.branch);
    const serial = pick(norm, COLS.serial);
    const pssName = pick(norm, ["pssname", "pss"]);
    const custCode = pick(norm, ["custcode", "customercode", "kodecustomer"]);
    const custType = pick(norm, ["custtype", "customertype", "tipecustomer"]);
    const hmDay = pick(norm, COLS.hmDay);
    const dayMonth = pick(norm, COLS.dayMonth);
    const monthYear = pick(norm, COLS.monthYear);
    const qty = num(pick(norm, ["invoicedquantity", "invoicedqty"]));

    // Baris kosong total (mis. sisa format di bawah tabel) dilewati tanpa dilaporkan.
    if (Object.values(r).every((v) => v === null || v === undefined || String(v).trim() === "")) return;

    // A row needs at minimum a Product so it means something as a unit.
    if (!product) {
      skipped++;
      flag("product", "Product", "penting", "Product kosong — baris dilewati (tidak disimpan)", rowNo);
      return;
    }
    // Invoiced Quantity negatif = retur/pembatalan, bukan unit yang beroperasi.
    if (qty !== null && qty < 0) {
      returns++;
      return;
    }

    // Year Inv: angka tahun; tanggal lengkap juga diterima (tahun & bulan diambil dari tanggal itu).
    let yearNum: number | null = null;
    let monthFromDate: number | null = null;
    if (yearRaw !== null) {
      const yn = Number(yearRaw);
      if (typeof yearRaw === "number" && yn > 20000 && yn < 80000) {
        const d = new Date(Math.round((yn - 25569) * 86400000)); // nomor seri tanggal Excel
        yearNum = d.getUTCFullYear();
        monthFromDate = d.getUTCMonth() + 1;
      } else if (Number.isInteger(yn)) {
        yearNum = yn;
      } else {
        const m = /^(\d{4})[-/.](\d{1,2})/.exec(String(yearRaw).trim());
        if (m) {
          yearNum = Number(m[1]);
          monthFromDate = Number(m[2]);
        }
      }
    }
    if (yearNum !== null && (yearNum < 1980 || yearNum > thisYear + 1)) {
      flag("year-bad", "Year Inv", "penting", `Year Inv tidak masuk akal (di luar 1980–${thisYear}) — dianggap kosong`, rowNo);
      yearNum = null;
    } else if (yearRaw === null) {
      if (has("year")) flag("year-empty", "Year Inv", "penting", "Year Inv kosong — unit dihitung di semua tahun", rowNo);
    } else if (yearNum === null) {
      flag("year-bad", "Year Inv", "penting", "Year Inv bukan angka tahun — dianggap kosong", rowNo);
    } else if (yearNum > thisYear) {
      flag("year-future", "Year Inv", "penting", `Year Inv setelah ${thisYear} (masa depan)`, rowNo);
    }

    let monthNum = parseMonth(monthRaw);
    if (monthNum === null && monthFromDate !== null) monthNum = monthFromDate;
    if (monthRaw !== null && monthNum === null) {
      flag("month-bad", "Month Inv", "penting", "Month Inv tidak valid (harus 1–12 atau nama bulan) — dianggap kosong", rowNo);
    } else if (monthNum === null) {
      if (has("month")) flag("month-empty", "Month Inv", "penting", "Month Inv kosong — unit dianggap beroperasi setahun penuh di tahun belinya", rowNo);
    } else if (yearNum === thisYear && monthNum > thisMonth) {
      flag("month-future", "Month Inv", "penting", "Month Inv setelah bulan ini (masa depan)", rowNo);
    }

    if (opts.minYear !== undefined && yearNum !== null && yearNum < opts.minYear) {
      beforeMinYear++;
      return;
    }

    if (!str(model)) flag("model", "Model", "penting", "Model kosong — unit tidak bisa dicocokkan dengan Master Part", rowNo);
    if (!str(custName)) flag("custName", "Cust. Name", "penting", "Cust. Name kosong — unit tidak masuk ke customer mana pun", rowNo);
    if (!str(custGroup)) flag("custGroup", "Cust. Group", "info", "Cust. Group kosong", rowNo);
    if (!str(branch)) flag("branch", "Branch", "info", "Branch kosong", rowNo);
    const ser = str(serial);
    if (!ser || ser.length < 3) flag("serial", "Serial Number", "info", "Serial Number kosong — unit tidak bisa dicek dobel", rowNo);
    const hm = num(hmDay), dm = num(dayMonth), my = num(monthYear);
    if (hm === null || hm <= 0 || hm > 24) flag("hm", "HM/Day", "info", "HM/Day kosong/tidak valid (harus 1–24) — dipakai nilai default", rowNo);
    if (dm === null || dm <= 0 || dm > 31) flag("dm", "Day/Month", "info", "Day/Month kosong/tidak valid (harus 1–31) — dipakai nilai default", rowNo);
    if (my === null || my <= 0 || my > 12) flag("my", "Month/Year", "info", "Month/Year kosong/tidak valid (harus 1–12) — dipakai nilai default", rowNo);

    parsed.push({
      year: yearNum,
      month_inv: monthNum,
      product: str(product)?.toUpperCase() ?? null,
      model: str(model),
      customer_group: str(custGroup),
      customer_name: str(custName),
      branch: str(branch),
      serial_number: ser,
      pss_name: str(pssName),
      customer_code: str(custCode),
      customer_type: str(custType),
      hm_day: hm,
      day_month: dm,
      month_year: my
    });
  });

  if (parsed.length === 0) {
    throw new ParseError(
      "Tidak ada baris valid. Pastikan ada kolom Product (nama brand) yang terisi — kolom lain (Year Inv, Month Inv, Model, " +
        "Customer Group, Branch, Serial Number) boleh sebagian kosong."
    );
  }
  const order = { penting: 0, info: 1 };
  const issues = Array.from(issueMap.values()).sort((a, b) => order[a.level] - order[b.level] || b.count - a.count);
  return {
    rows: parsed,
    skipped,
    returns,
    beforeMinYear,
    sheetName: best.name,
    validation: { totalRows: best.rows.length, missingColumns, issues }
  };
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
