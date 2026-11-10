import * as XLSX from "@e965/xlsx";
import { ParseError } from "./xlsxHelpers";
import { PRICE_TYPE_LABEL, UIO_PRICE_TYPE_OPTIONS, normCode, normPriceType } from "@/lib/priceType";
import { companyKey, loose, makeMatcher } from "@/lib/fuzzy";
import { canonicalProduct } from "@/lib/calculations";
import { uioSerialKey } from "@/lib/uioKey";

/** One row of raw output from the parser — the API route turns this into a
 * uio_units row (adding the dedupe_key, since that needs upload-time logic
 * to fall back safely when Serial Number is missing/placeholder). */
export type UioUnitParsed = {
  /** Year BAST — tahun BAST (serah terima) unit. */
  year: number | null;
  /** Month BAST — bulan BAST (serah terima) (1–12). Kosong = dianggap beroperasi setahun penuh di tahun belinya. */
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
  /** Price Type unit: "Kontrak" / "SCPL" / "Non-Kontrak"; null = kosong (aturan lama). */
  price_type: string | null;
};

/** Nilai yang sudah dikenal (dari data website) untuk mengecek ejaan isian file. */
export type UioKnown = {
  branches?: string[];
  custTypes?: string[];
  /** Product → model di Master Part. */
  partModelsByProduct?: Record<string, string[]>;
  /** Customer Code yang punya harga di Data Harga Kontrak / SCPL. */
  contractCodes?: string[];
  /** Ejaan Customer Name / Customer Group / PSS yang sudah ada di website (cek typo). */
  names?: string[];
  groups?: string[];
  pss?: string[];
};

export type UioUnitsParseResult = {
  rows: UioUnitParsed[];
  skipped: number;
  /** Baris retur/pembatalan (Invoiced Quantity negatif) yang dibuang. */
  returns: number;
  /** Baris dengan tahun di bawah batas awal (minYear) yang dibuang. */
  beforeMinYear: number;
  sheetName: string;
  /** Semua sheet yang berisi tabel unit (punya kolom Product), dengan jumlah barisnya — untuk pilihan sheet. */
  sheets: { name: string; rows: number }[];
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
  // Year/Month BAST (judul lama Year Inv / Month Inv tetap terbaca).
  year: ["yearbast", "tahunbast", "yearinv", "tahuninv", "yearinvoice", "tahuninvoice", "tahun", "year"],
  month: ["monthbast", "bulanbast", "monthinv", "bulaninv", "monthinvoice", "bulaninvoice", "invmonth"],
  product: ["product", "produk", "brand", "productdescription"],
  model: ["model", "modelunit", "modeldescription"],
  custGroup: ["custgroup", "customergroup"],
  custName: ["customername", "custname", "name1", "newcustomername", "cn"],
  branch: ["branchuioconfirm", "branchuioconfirmation", "branchuio", "branch", "cabang", "soff", "salesoffice"],
  serial: ["serialnumber", "unitserialnumber", "serialnumberunit", "nomorseri"],
  hmDay: ["hmday", "hmperhari"],
  dayMonth: ["daymonth", "activedaysmonth", "harikerjabulan", "dayspermonth"],
  monthYear: ["monthyear", "bulantahun", "monthsperyear"],
  priceType: ["pricetype", "tipeharga", "jenisharga", "pricecategory"]
};
const COL_LABEL: Record<keyof typeof COLS, string> = {
  year: "Year BAST", month: "Month BAST", product: "Product", model: "Model", custGroup: "Cust. Group",
  custName: "Cust. Name", branch: "Branch", serial: "Serial Number", hmDay: "HM/Day", dayMonth: "Day/Month",
  monthYear: "Month/Year", priceType: "Price Type"
};

const ALL_KEYS = new Set(Object.values(COLS).flat());

/** Baca satu sheet sebagai tabel. Judul kolom tidak harus di baris 1: baris judul = baris pertama (dari 20 baris teratas)
 * yang memuat minimal 3 judul kolom yang dikenal — jadi laporan dengan judul/keterangan di atas tabel tetap terbaca. */
function readTable(ws: XLSX.WorkSheet): { rows: Record<string, unknown>[]; headerRow: number; hasProduct: boolean } {
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, blankrows: true });
  let headerRow = 0;
  for (let r = 0; r < Math.min(aoa.length, 20); r++) {
    const hits = (aoa[r] || []).filter((c) => c !== null && ALL_KEYS.has(normKey(String(c)))).length;
    if (hits >= 3) {
      headerRow = r;
      break;
    }
  }
  const head = (aoa[headerRow] || []).map((c, i) => (c === null || String(c).trim() === "" ? `__col${i}` : String(c)));
  // Judul kolom kembar (mis. dua "Business Sector"): yang pertama dipakai.
  const seen = new Set<string>();
  const keys = head.map((h) => {
    let k = h;
    while (seen.has(k)) k += "_";
    seen.add(k);
    return k;
  });
  const rows: Record<string, unknown>[] = [];
  for (let r = headerRow + 1; r < aoa.length; r++) {
    const line = aoa[r] || [];
    const o: Record<string, unknown> = {};
    keys.forEach((k, i) => (o[k] = line[i] ?? null));
    rows.push(o);
  }
  // Baris kosong di ujung bawah tidak dihitung.
  while (rows.length > 0 && Object.values(rows[rows.length - 1]).every((v) => v === null || String(v).trim() === "")) rows.pop();
  const hasProduct = head.some((h) => COLS.product.includes(normKey(h)));
  return { rows, headerRow, hasProduct };
}

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
export function parseUioUnitsWorkbook(wb: XLSX.WorkBook, opts: { minYear?: number; sheet?: string; known?: UioKnown } = {}): UioUnitsParseResult {
  // ---- daftar nilai yang dikenal (cek ejaan) ----
  const K = opts.known;
  const matcherOf = (vals?: string[]) => (vals && vals.length > 0 ? makeMatcher(vals) : null);
  const mBranch = matcherOf(K?.branches?.map((b) => b.trim().toUpperCase()));
  const mType = matcherOf(K?.custTypes);
  // Nama customer: "KAHATEX,PT" dan "PT. KAHATEX" dianggap sama (abaikan PT/CV/Tbk) → disamakan dengan ejaan di website.
  const mName = K?.names && K.names.length > 0 ? makeMatcher(K.names, companyKey) : null;
  const mGroup = matcherOf(K?.groups);
  const mPss = matcherOf(K?.pss);
  const mPrice = makeMatcher(UIO_PRICE_TYPE_OPTIONS);
  const mProduct = makeMatcher(Object.keys(K?.partModelsByProduct || {}));
  const modelMatchers = new Map<string, ReturnType<typeof makeMatcher>>();
  const modelMatcher = (pk: string) => {
    let m = modelMatchers.get(pk);
    if (!m) {
      const raw = Object.entries(K?.partModelsByProduct || {}).find(([p]) => p.trim().toUpperCase() === pk)?.[1] || [];
      modelMatchers.set(pk, (m = makeMatcher(raw)));
    }
    return m;
  };
  const contractCodes = K?.contractCodes && K.contractCodes.length > 0 ? new Set(K.contractCodes.map(normCode)) : null;
  const pm = K?.partModelsByProduct &&Object.keys(K.partModelsByProduct).length > 0 ? K.partModelsByProduct : null;
  const nm = (m: string) => m.toUpperCase().replace(/[\s-]/g, "");
  const partModels = new Map<string, string[]>();
  if (pm) Object.entries(pm).forEach(([p, ms]) => partModels.set(p.trim().toUpperCase(), ms.map(nm)));
  const modelMatches = (p: string, m: string) => {
    const list = partModels.get(p);
    if (!list) return false;
    const um = nm(m);
    return list.some((x) => um === x || (x.length >= 3 && um.startsWith(x)));
  };
  const tables = wb.SheetNames.map((name) => ({ name, ...readTable(wb.Sheets[name]) }));
  const withProduct = tables.filter((t) => t.hasProduct && t.rows.length > 0);
  const sheets = withProduct.map((t) => ({ name: t.name, rows: t.rows.length }));
  let best: { name: string; rows: Record<string, unknown>[]; headerRow: number } | null = null;
  if (opts.sheet) {
    const t = tables.find((x) => x.name === opts.sheet);
    if (!t) throw new ParseError(`Sheet "${opts.sheet}" tidak ditemukan.`);
    best = t;
  } else {
    // Sheet dengan baris terbanyak yang punya kolom Product (biasanya tab populasi).
    for (const t of withProduct.length > 0 ? withProduct : tables) if (!best || t.rows.length > best.rows.length) best = t;
  }
  if (!best || best.rows.length === 0) {
    throw new ParseError("File kosong atau tidak terbaca.");
  }
  const headerRow = best.headerRow;

  const parsed: UioUnitParsed[] = [];
  const seenRow = new Map<string, number>();
  const seenSerial = new Map<string, number>();
  const seenZero = new Map<string, { raw: string; row: number }>();
  let duplicates = 0;
  let conflictSerial = 0;
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
  /**
   * Ejaan satu nilai dibandingkan dengan data website:
   *   - sama kecuali huruf besar/kecil, spasi, tanda baca → otomatis disamakan dengan ejaan di website (dilaporkan sebagai info);
   *   - tidak ada, tapi ada yang sangat mirip → peringatan "mungkin maksudnya …?" (nilai tetap seperti di file);
   *   - tidak ada sama sekali → pesan `none` (bila diisi).
   */
  const spell = (
    field: string,
    m: ReturnType<typeof makeMatcher> | null,
    raw: unknown,
    rowNo: number,
    o: { level: UioIssue["level"]; key?: string; none?: string; note?: string }
  ): string | null => {
    const v = str(raw);
    if (!v || !m) return v;
    const r = m(v);
    if (r.exact !== null) {
      if (r.exact !== v) {
        const k = `fixed:${field}`;
        if (!issueMap.has(k)) flag(k, field, "info", `Ejaan ${field} disamakan otomatis dengan data website (contoh: "${v}" → "${r.exact}")`, rowNo);
        else flag(k, field, "info", "", rowNo);
      }
      return r.exact;
    }
    if (r.suggest) {
      flag(`typo:${field}|${loose(v)}`, field, o.level, `${field} "${v}" tidak dikenal — mungkin maksudnya "${r.suggest}"?${o.note ? ` (${o.note})` : ""}`, rowNo);
    } else if (o.none) flag(o.key || `unknown:${field}`, field, o.level, o.none, rowNo);
    return v;
  };
  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth() + 1;
  const has = (f: keyof typeof COLS) => !missingColumns.includes(COL_LABEL[f]);

  best.rows.forEach((r, i) => {
    const rowNo = i + headerRow + 2; // nomor baris di Excel (judul kolom di baris headerRow + 1)
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
    const priceTypeRaw = pick(norm, COLS.priceType);

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

    // Year BAST: angka tahun; tanggal lengkap juga diterima (tahun & bulan diambil dari tanggal itu).
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
      flag("year-bad", "Year BAST", "penting", `Year BAST tidak masuk akal (di luar 1980–${thisYear}) — dianggap kosong`, rowNo);
      yearNum = null;
    } else if (yearRaw === null) {
      if (has("year")) flag("year-empty", "Year BAST", "penting", "Year BAST kosong — unit dihitung di semua tahun", rowNo);
    } else if (yearNum === null) {
      flag("year-bad", "Year BAST", "penting", "Year BAST bukan angka tahun — dianggap kosong", rowNo);
    } else if (yearNum > thisYear) {
      flag("year-future", "Year BAST", "penting", `Year BAST setelah ${thisYear} (masa depan)`, rowNo);
    }

    let monthNum = parseMonth(monthRaw);
    if (monthNum === null && monthFromDate !== null) monthNum = monthFromDate;
    if (monthRaw !== null && monthNum === null) {
      flag("month-bad", "Month BAST", "penting", "Month BAST tidak valid (harus 1–12 atau nama bulan) — dianggap kosong", rowNo);
    } else if (monthNum === null) {
      if (has("month")) flag("month-empty", "Month BAST", "penting", "Month BAST kosong — unit dianggap beroperasi penuh /year di tahun BAST-nya", rowNo);
    } else if (yearNum === thisYear && monthNum > thisMonth) {
      flag("month-future", "Month BAST", "penting", "Month BAST setelah bulan ini (masa depan)", rowNo);
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
    // ---- ejaan: samakan dengan data website, atau beri saran bila typo ----
    const branchV = spell("Branch", mBranch, branch, rowNo, {
      level: "penting", key: "branch-unknown", none: "Branch belum pernah ada di data (cek ejaan / kode cabang)"
    });
    const typeV = spell("Cust. Type", mType, custType, rowNo, {
      level: "penting", key: "type-unknown", none: `Cust. Type tidak dikenal — harus salah satu: ${(K?.custTypes || []).join(", ")}`
    });
    const nameV = spell("Cust. Name", mName, custName, rowNo, { level: "info", note: "cek typo; abaikan bila memang customer baru" });
    const groupV = spell("Cust. Group", mGroup, custGroup, rowNo, { level: "info", note: "cek typo; abaikan bila memang group baru" });
    const pssV = spell("Pss Name", mPss, pssName, rowNo, { level: "info", note: "cek typo; abaikan bila memang PSS baru" });
    let modelV = str(model);
    if (pm) {
      const pk = canonicalProduct(String(product));
      if (!partModels.has(pk)) {
        const s = mProduct(product).suggest;
        if (s) flag(`product-typo:${loose(product)}`, "Product", "penting", `Product "${str(product)}" tidak ada di Master Part — mungkin maksudnya "${s}"?`, rowNo);
        else flag("product-nomp", "Product", "info", "Product tidak ada di Master Part — unit tidak menyumbang Market Size", rowNo);
      } else if (modelV && !modelMatches(pk, modelV)) {
        const s = modelMatcher(pk)(modelV).suggest;
        if (s) flag(`model-typo:${pk}|${loose(modelV)}`, "Model", "penting", `Model "${modelV}" (${pk}) tidak cocok dengan Master Part — mungkin maksudnya "${s}"?`, rowNo);
        else flag("model-nomp", "Model", "info", "Model tidak cocok dengan model di Master Part (cek ejaan) — unit tidak menyumbang Market Size", rowNo);
      }
    }
    const pt = normPriceType(priceTypeRaw);
    if (priceTypeRaw !== null && !pt) {
      const s = mPrice(priceTypeRaw).suggest;
      flag(
        s ? `pt-typo:${loose(priceTypeRaw)}` : "pt-bad",
        "Price Type",
        "penting",
        s
          ? `Price Type "${str(priceTypeRaw)}" tidak dikenal — mungkin maksudnya "${s}"? (sementara dianggap kosong)`
          : "Price Type tidak dikenal (harus Kontrak / SCPL / Non-Kontrak) — dianggap kosong",
        rowNo
      );
    }
    else if (!pt && has("priceType")) flag("pt-empty", "Price Type", "info", "Price Type kosong — harga Kontrak/SCPL dipakai bila Cust. Code-nya punya, selain itu Harga Non Kontrak", rowNo);
    else if (pt === "contract" || pt === "scpl") {
      const code = normCode(custCode);
      if (!code) flag("pt-nocode", "Cust. Code", "penting", "Price Type Kontrak/SCPL tapi Cust. Code kosong — harga kontrak tidak bisa dicari, dipakai Harga Non Kontrak", rowNo);
      else if (contractCodes && !contractCodes.has(code))
        flag("pt-noprice", "Cust. Code", "info", "Price Type Kontrak/SCPL tapi Cust. Code ini belum punya harga di Data Harga Kontrak/SCPL — sementara dipakai Harga Non Kontrak", rowNo);
    }

    const rec: UioUnitParsed = {
      year: yearNum,
      month_inv: monthNum,
      // Kode product (PER, TYT, MFT, …) disimpan sebagai nama Product (PERKINS, TOYOTA, MF) supaya unit yang sama tidak tersimpan dua kali.
      product: str(product) ? canonicalProduct(str(product)) : null,
      model: modelV,
      customer_group: groupV,
      customer_name: nameV,
      branch: branchV,
      serial_number: ser,
      pss_name: pssV,
      customer_code: str(custCode),
      customer_type: typeV,
      hm_day: hm,
      day_month: dm,
      month_year: my,
      price_type: pt ? PRICE_TYPE_LABEL[pt] : null
    };
    // ---- baris dobel ----
    // 1) Baris yang isinya sama persis dengan baris lain → disimpan satu kali saja.
    const sig = JSON.stringify(rec);
    const firstRow = seenRow.get(sig);
    if (firstRow !== undefined) {
      duplicates++;
      flag("dup-row", "Baris dobel", "info", `Isi baris sama persis dengan baris lain (mis. baris ${firstRow}) — disimpan satu kali`, rowNo);
      return;
    }
    seenRow.set(sig, rowNo);
    // 2) Product + Serial Number sama tapi isi lain berbeda → satu unit fisik; yang disimpan baris paling bawah.
    const sk = rec.serial_number ? uioSerialKey(canonicalProduct(rec.product), rec.serial_number) : null;
    if (sk) {
      const prev = seenSerial.get(sk);
      if (prev !== undefined) {
        flag("dup-serial", "Serial Number", "penting", `Product + Serial Number sama dengan baris lain (mis. baris ${prev}) tapi isinya berbeda — yang disimpan baris paling bawah`, rowNo);
        conflictSerial++;
      }
      seenSerial.set(sk, rowNo);
      // Serial yang sama kalau nol di depannya diabaikan (mis. "000006916615" dan "6916615") → kemungkinan unit dobel.
      const ser = String(rec.serial_number).trim().toUpperCase();
      const zk = `${canonicalProduct(rec.product)}::${ser.replace(/^0+(?=.)/, "")}`;
      const z = seenZero.get(zk);
      if (z && z.raw !== ser)
        flag("dup-serial-zero", "Serial Number", "penting", `Serial Number "${ser}" sama dengan "${z.raw}" (baris ${z.row}) kalau nol di depan diabaikan — kemungkinan unit yang sama ditulis dua kali`, rowNo);
      else if (!z) seenZero.set(zk, { raw: ser, row: rowNo });
      if (/^0{3,}\d/.test(ser))
        flag("serial-zero", "Serial Number", "info", "Serial Number diawali banyak angka 0 — pastikan penulisannya sama dengan data lain (mis. tanpa nol di depan)", rowNo);
    }
    parsed.push(rec);
  });

  if (parsed.length === 0) {
    throw new ParseError(
      "Tidak ada baris valid. Pastikan ada kolom Product (nama brand) yang terisi — kolom lain (Year BAST, Month BAST, Model, " +
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
    sheets,
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
