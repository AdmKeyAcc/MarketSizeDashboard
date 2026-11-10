/** Template downloads for the upload types (Data UIO, Data Harga, Master Part, Actual Sales).
 * ExcelJS is imported dynamically so the library is only pulled into the
 * bundle when the user actually clicks "Unduh template". It's used here
 * (instead of @e965/xlsx, used elsewhere in the app) specifically because
 * it can actually write cell styles — @e965/xlsx parses styles but silently
 * drops them when writing, so the header row never came out colored. */

import { CONTRACT_PRICE_TYPE_OPTIONS, UIO_PRICE_TYPE_OPTIONS } from "@/lib/priceType";

async function downloadWorkbook(
  sheetName: string,
  rows: Record<string, string | number>[],
  colWidths: number[],
  filename: string,
  headerOnly = false
) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);

  const headers = Object.keys(rows[0] ?? {});
  ws.columns = headers.map((header, i) => ({ header, key: header, width: colWidths[i] ?? 16 }));
  if (!headerOnly) rows.forEach((row) => ws.addRow(row));

  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
  });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Aturan isi satu kolom template (dropdown / angka), supaya isian cabang tidak typo. */
export type ColRule =
  /** Dropdown. Selalu berupa peringatan (paste tidak diblokir); strict = pesan lebih tegas (nilai harus dari daftar). */
  | { kind: "list"; values: string[]; strict: boolean; hint?: string }
  /** Dropdown yang isinya tergantung kolom lain (mis. Model menurut Product). */
  | { kind: "dependent"; parentCol: number; map: Record<string, string[]>; strict: boolean; hint?: string }
  /** Angka bulat / desimal dalam rentang. */
  | { kind: "whole" | "decimal"; min: number; max: number; hint?: string }
  /** Tidak boleh dobel di kolom ini (mis. Serial Number) — peringatan. */
  | { kind: "unique"; hint?: string };

export type SheetSpec = {
  name: string;
  headers: string[];
  widths: number[];
  rows: (string | number | null)[][];
  /** Format angka per kolom (indeks kolom → format Excel, mis. "#,##0"). */
  numFmt?: Record<number, string>;
  /** Dropdown pilihan tetap per kolom (indeks kolom → daftar pilihan). */
  lists?: Record<number, string[]>;
  /** Aturan isi per kolom (dropdown dari data, angka, tidak dobel). */
  rules?: Record<number, ColRule>;
};

const colLetter = (i: number) => {
  let n = i + 1, s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};
/** Baris yang diberi aturan: semua baris data + cadangan untuk baris baru. */
const LIST_ROWS = 20000;
const LIST_SHEET = "Daftar Pilihan";
/** Nama range untuk dropdown bertingkat: "M_" + nilai induk (huruf/angka/_), sama dengan rumus INDIRECT di bawah. */
const depName = (v: string) => "M_" + v.toUpperCase().replace(/[ \-.\/&()]/g, "_");
const uniqSorted = (a: string[]) => Array.from(new Set(a.map((x) => String(x).trim()).filter(Boolean))).sort((x, y) => x.localeCompare(y));

/** Warna penanda sel yang isinya salah / belum dikenal (merah muda) dan dobel (oranye). */
const BAD_STYLE = { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFC7CE" } }, font: { color: { argb: "FF9C0006" } } };
const DUP_STYLE = { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFE0B2" } }, font: { color: { argb: "FF8A4B00" } } };

/**
 * Tulis satu atau beberapa sheet (header berwarna, baris judul dibekukan) lalu unduh.
 * Penjaga typo dibuat ramah paste:
 *   - Dropdown tetap ada, tapi hanya PERINGATAN (tidak pernah memblokir), jadi data bisa di-paste sekaligus.
 *   - Conditional formatting: sel yang isinya tidak ada di Daftar Pilihan / angka di luar rentang / dobel
 *     otomatis berwarna. Rumus memakai INDIRECT supaya juga jalan di Google Sheets.
 *   - Sheet "Daftar Pilihan" terlihat (contekan ejaan) dan sheet "Petunjuk".
 * Pengecekan utama tetap di website saat upload.
 */
export async function saveWorkbook(sheets: SheetSpec[], filename: string, opts: { help?: boolean } = {}) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let listWs: any = null;
  let listCol = 0;
  /** Tulis daftar ke sheet Daftar Pilihan; hasil = alamat range (mis. 'Daftar Pilihan'!$A$2:$A$10) tanpa tanda $ juga. */
  const putList = (title: string, values: string[], name?: string): { ref: string; plain: string } => {
    if (!listWs) {
      listWs = wb.addWorksheet(LIST_SHEET, { views: [{ state: "frozen", ySplit: 1 }] });
    }
    const c = colLetter(listCol++);
    listWs.getCell(`${c}1`).value = title;
    listWs.getCell(`${c}1`).font = { bold: true, color: { argb: "FFFFFFFF" } };
    listWs.getCell(`${c}1`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
    listWs.getColumn(listCol).width = Math.min(40, Math.max(14, title.length + 2, ...values.slice(0, 500).map((v) => String(v).length + 2)));
    values.forEach((v, i) => (listWs.getCell(`${c}${i + 2}`).value = v));
    const endRow = Math.max(values.length + 1, 2);
    const ref = `'${LIST_SHEET}'!$${c}$2:$${c}$${endRow}`;
    if (name) wb.definedNames.add(ref, name);
    return { ref, plain: `'${LIST_SHEET}'!${c}2:${c}${endRow}` };
  };

  sheets.forEach((sh) => {
    const ws = wb.addWorksheet(sh.name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = sh.headers.map((header, i) => ({ header, key: `c${i}`, width: sh.widths[i] ?? 16 }));
    ws.addRows(sh.rows);
    Object.entries(sh.numFmt || {}).forEach(([i, f]) => {
      ws.getColumn(Number(i) + 1).numFmt = f;
    });
    const last = Math.max(LIST_ROWS, sh.rows.length + 1000);
    const rangeOf = (i: number) => `${colLetter(i)}2:${colLetter(i)}${last}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const addDv = (i: number, dv: any) => (ws as any).dataValidations.add(rangeOf(i), dv);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const addCf = (i: number, formula: string, style: any = BAD_STYLE) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ws as any).addConditionalFormatting({ ref: rangeOf(i), rules: [{ type: "expression", priority: 1, formulae: [formula], style }] });
    const head = (i: number) => sh.headers[i];
    const warnMsg = (i: number, text: string) => ({ showErrorMessage: true, errorStyle: "warning", errorTitle: head(i), error: text });
    const prompt = (i: number, t: string) => ({ showInputMessage: true, promptTitle: head(i), prompt: t.slice(0, 250) });
    /** Dropdown + penanda merah untuk daftar tetap. */
    const listRule = (i: number, vals: string[], strict: boolean, hint?: string) => {
      if (vals.length === 0) return;
      const { ref, plain } = putList(head(i), vals);
      const c = `${colLetter(i)}2`;
      addDv(i, {
        type: "list", allowBlank: true, formulae: [ref],
        ...warnMsg(i, strict ? `Nilai harus salah satu dari daftar (lihat sheet ${LIST_SHEET}). Klik No lalu pilih dari dropdown.` : "Nilai ini belum ada di daftar. Cek ejaannya — klik Yes kalau memang data baru."),
        ...prompt(i, hint || (strict ? "Pilih dari dropdown." : "Pilih dari dropdown, atau ketik bila data baru."))
      });
      addCf(i, `AND(TRIM(${c})<>"",COUNTIF(INDIRECT("${plain.replace(/"/g, '""')}"),TRIM(${c}))=0)`);
    };
    Object.entries(sh.lists || {}).forEach(([k, opts]) => listRule(Number(k), opts, true));
    Object.entries(sh.rules || {}).forEach(([k, r]) => {
      const i = Number(k);
      const c = `${colLetter(i)}2`;
      if (r.kind === "list") {
        listRule(i, uniqSorted(r.values), r.strict, r.hint);
      } else if (r.kind === "dependent") {
        const keys = Object.keys(r.map).filter((p) => (r.map[p] || []).length > 0);
        if (keys.length === 0) return;
        keys.forEach((p) => putList(`${head(r.parentCol)}: ${p}`, uniqSorted(r.map[p]), depName(p)));
        const pc = `$${colLetter(r.parentCol)}2`;
        const f = `INDIRECT("M_"&SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(UPPER(TRIM(${pc}))," ","_"),"-","_"),".","_"),"/","_"),"&","_"),"(","_"),")","_"))`;
        addDv(i, {
          type: "list", allowBlank: true, formulae: [f],
          ...warnMsg(i, `${head(i)} ini belum ada untuk ${head(r.parentCol)} tersebut. Cek ejaannya — klik Yes kalau memang model baru.`),
          ...prompt(i, r.hint || `Isi ${head(r.parentCol)} dulu, lalu pilih ${head(i)} dari dropdown (atau ketik bila model baru).`)
        });
        addCf(i, `AND(TRIM(${c})<>"",ISERROR(MATCH(TRIM(${c}),${f},0)))`);
      } else if (r.kind === "whole" || r.kind === "decimal") {
        addDv(i, {
          type: r.kind, operator: "between", allowBlank: true, formulae: [r.min, r.max],
          ...warnMsg(i, `Isi angka ${r.kind === "whole" ? "bulat " : ""}${r.min}–${r.max}.`),
          ...prompt(i, r.hint || `Angka ${r.kind === "whole" ? "bulat " : ""}${r.min}–${r.max}.`)
        });
        const intCheck = r.kind === "whole" ? `,${c}<>INT(${c})` : "";
        addCf(i, `AND(${c}<>"",OR(NOT(ISNUMBER(${c})),${c}<${r.min},${c}>${r.max}${intCheck}))`);
      } else if (r.kind === "unique") {
        const col = colLetter(i);
        addDv(i, {
          type: "custom", allowBlank: true, formulae: [`COUNTIF($${col}$2:$${col}$${last},${c})<=1`],
          ...warnMsg(i, `${head(i)} ini sudah ada di baris lain (dobel).`),
          ...prompt(i, r.hint || `${head(i)} tidak boleh dobel.`)
        });
        addCf(i, `AND(${c}<>"",COUNTIF($${col}$2:$${col}$${last},${c})>1)`, DUP_STYLE);
      }
    });
    ws.getRow(1).eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.alignment = { vertical: "middle", horizontal: "left" };
    });
  });

  // Petunjuk singkat cara mengisi (terutama paste data banyak) — hanya untuk template isian.
  if (opts.help !== false) {
  const help = wb.addWorksheet("Petunjuk");
  help.getColumn(1).width = 110;
  [
    "Cara mengisi template",
    "",
    "1. Boleh mengetik satu per satu (pakai dropdown) atau paste data sekaligus dari file lain.",
    "2. Saat paste, gunakan Paste Values (Ctrl+Shift+V, atau klik kanan > Paste Special > Values) supaya penanda warna tetap berfungsi.",
    "3. Sel berwarna MERAH = isinya tidak ada di daftar (kemungkinan typo) atau angka di luar rentang. Cek ejaannya di sheet Daftar Pilihan.",
    "4. Sel berwarna ORANYE = nilai dobel (mis. Serial Number yang sama muncul lebih dari sekali).",
    "5. Kalau memang data baru (customer / model baru), sel merah boleh dibiarkan.",
    "6. Saat upload, website mengecek ulang seluruh isi file: ejaan yang hanya beda huruf besar/kecil, spasi atau titik disamakan otomatis,",
    "   dan typo diberi saran (\"mungkin maksudnya ...\"). Pilih Perbaiki file atau Lanjutkan upload."
  ].forEach((t, i) => {
    const cell = help.getCell(`A${i + 1}`);
    cell.value = t;
    if (i === 0) cell.font = { bold: true, size: 13 };
  });
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const UIO_HEADERS = ["Branch", "Pss Name", "Cust. Code", "Cust. Name", "Cust. Group", "Cust. Type", "Price Type", "Product", "Model", "Serial Number", "Year BAST", "Month BAST", "HM/Day", "Day/Month", "Month/Year"];
export const UIO_WIDTHS = [14, 18, 14, 28, 22, 18, 14, 14, 16, 20, 10, 11, 10, 11, 12];
export const UIO_PRICE_COL = 6;
export const CONTRACT_HEADERS = ["Cust. Code", "Cust. Name", "Cust. Group", "Cust. Type", "Price Type", "Part Number", "Harga"];
export const CONTRACT_WIDTHS = [14, 28, 22, 18, 14, 20, 16];
export const CONTRACT_PRICE_COL = 4;
export const NON_CONTRACT_HEADERS = ["Cust. Code", "Cust. Name", "Cust. Group", "Cust. Type", "Part Number", "Harga"];
export const NON_CONTRACT_WIDTHS = [14, 28, 22, 18, 20, 16];
export const MASTER_PART_HEADERS = ["Product", "Model Unit", "Part Number", "Part Name", "Qty per Unit", "Frekuensi Ganti (HM)", "HM per Hari"];
export const MASTER_PART_WIDTHS = [14, 18, 20, 28, 13, 20, 12];

/** Daftar pilihan untuk dropdown template — diambil dari data yang sudah ada di website. */
export type TemplateLists = {
  branches: string[];
  pss: string[];
  groups: string[];
  names: string[];
  custTypes: string[];
  /** Product yang dikenal (Master Part + Data UIO). */
  products: string[];
  /** Product → model (Master Part + Data UIO). */
  modelsByProduct: Record<string, string[]>;
  partNumbers: string[];
  /** Customer Code yang dikenal (Data UIO / Master Customer). */
  codes: string[];
  /** Hanya Master Part: product → model (untuk cek model saat upload Data UIO). */
  partModelsByProduct: Record<string, string[]>;
  /** Customer Code yang punya harga Kontrak / SCPL (untuk cek Price Type saat upload Data UIO). */
  contractCodes: string[];
};
export const EMPTY_LISTS: TemplateLists = { branches: [], pss: [], groups: [], names: [], custTypes: [], products: [], modelsByProduct: {}, partNumbers: [], codes: [], partModelsByProduct: {}, contractCodes: [] };

const thisYear = () => new Date().getFullYear();

/** Aturan kolom per jenis template. */
export function uioRules(L: TemplateLists): Record<number, ColRule> {
  return {
    0: { kind: "list", values: L.branches, strict: false, hint: "Pilih kode cabang dari dropdown (mis. JKT, PTK)." },
    1: { kind: "list", values: L.pss, strict: false },
    3: { kind: "list", values: L.names, strict: false, hint: "Pilih nama customer dari dropdown supaya sama persis dengan data Actual; ketik bila customer baru." },
    4: { kind: "list", values: L.groups, strict: false },
    5: { kind: "list", values: L.custTypes, strict: true },
    7: { kind: "list", values: L.products, strict: true, hint: "Pilih Product dari dropdown." },
    8: { kind: "dependent", parentCol: 7, map: L.modelsByProduct, strict: false },
    9: { kind: "unique" },
    10: { kind: "whole", min: 1980, max: thisYear() + 1 },
    11: { kind: "whole", min: 1, max: 12 },
    12: { kind: "decimal", min: 0, max: 24 },
    13: { kind: "whole", min: 1, max: 31 },
    14: { kind: "whole", min: 1, max: 12 }
  };
}
export function contractRules(L: TemplateLists): Record<number, ColRule> {
  return {
    0: { kind: "list", values: L.codes, strict: false, hint: "WAJIB diisi: Customer Code (kode Sold-to) customer yang punya harga kontrak / SCPL." },
    1: { kind: "list", values: L.names, strict: false },
    2: { kind: "list", values: L.groups, strict: false, hint: "Customer Group harus sama persis dengan di Data UIO / Actual — pilih dari dropdown." },
    3: { kind: "list", values: L.custTypes, strict: true },
    5: { kind: "list", values: L.partNumbers, strict: false, hint: "Part Number dari Master Part — pilih dari dropdown atau ketik bila part baru." },
    6: { kind: "decimal", min: 0, max: 1e12 }
  };
}
export function nonContractRules(L: TemplateLists): Record<number, ColRule> {
  return {
    3: { kind: "list", values: L.custTypes, strict: true },
    4: { kind: "list", values: L.partNumbers, strict: false, hint: "Part Number dari Master Part — pilih dari dropdown atau ketik bila part baru." },
    5: { kind: "decimal", min: 0, max: 1e12 }
  };
}
export function masterPartRules(L: TemplateLists): Record<number, ColRule> {
  return {
    0: { kind: "list", values: L.products, strict: false, hint: "Pilih Product dari dropdown (ketik bila brand baru)." },
    1: { kind: "dependent", parentCol: 0, map: L.modelsByProduct, strict: false },
    4: { kind: "decimal", min: 0, max: 10000 },
    5: { kind: "decimal", min: 1, max: 1000000 },
    6: { kind: "decimal", min: 0, max: 24 }
  };
}

export async function downloadUioTemplate(L: TemplateLists = EMPTY_LISTS) {
  // Hanya baris header (tanpa contoh data). Product wajib terisi; kolom lain boleh kosong.
  await saveWorkbook(
    [{ name: "Data UIO", headers: UIO_HEADERS, widths: UIO_WIDTHS, rows: [], lists: { [UIO_PRICE_COL]: UIO_PRICE_TYPE_OPTIONS }, rules: uioRules(L) }],
    "template_data_uio.xlsx"
  );
}

export async function downloadContractPriceTemplate(L: TemplateLists = EMPTY_LISTS) {
  // Data Harga Kontrak / SCPL — harga sudah nett. Hanya header.
  await saveWorkbook(
    [{ name: "Data Harga Kontrak", headers: CONTRACT_HEADERS, widths: CONTRACT_WIDTHS, rows: [], numFmt: { 6: "#,##0" }, lists: { [CONTRACT_PRICE_COL]: CONTRACT_PRICE_TYPE_OPTIONS }, rules: contractRules(L) }],
    "template_data_harga_kontrak_scpl.xlsx"
  );
}

export async function downloadNonContractPriceTemplate(L: TemplateLists = EMPTY_LISTS) {
  // Data Harga Non Kontrak — harga tertera, sistem otomatis dikurangi 50% saat upload. Hanya header.
  await saveWorkbook(
    [{ name: "Data Harga Non Kontrak", headers: NON_CONTRACT_HEADERS, widths: NON_CONTRACT_WIDTHS, rows: [], numFmt: { 5: "#,##0" }, rules: nonContractRules(L) }],
    "template_data_harga_non_kontrak.xlsx"
  );
}

export async function downloadMasterPartTemplate(L: TemplateLists = EMPTY_LISTS) {
  // Master Part — hubungan part ke Product/Model + Qty per unit & Frekuensi ganti. Hanya header.
  await saveWorkbook(
    [{ name: "Master Part", headers: MASTER_PART_HEADERS, widths: MASTER_PART_WIDTHS, rows: [], rules: masterPartRules(L) }],
    "template_master_part.xlsx"
  );
}

export async function downloadActualSalesTemplate() {
  // Actual Sales per transaksi/bulan. Hanya header.
  await downloadWorkbook(
    "Actual Sales",
    [
      {
        Tahun: "",
        Bulan: "",
        "Customer Group": "",
        "Customer Name": "",
        Product: "",
        "Model Unit": "",
        "Part Number": "",
        "Part Name": "",
        Qty: "",
        "Amount (Rp)": ""
      }
    ],
    [8, 12, 22, 28, 12, 16, 20, 26, 8, 14],
    "template_actual_sales.xlsx",
    true
  );
}
