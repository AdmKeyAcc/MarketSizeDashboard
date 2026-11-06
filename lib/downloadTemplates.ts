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
  /** Dropdown. strict = hanya boleh nilai di daftar; tidak strict = nilai baru boleh, tapi muncul peringatan. */
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

/** Tulis satu atau beberapa sheet (header berwarna, baris judul dibekukan, dropdown & validasi angka) lalu unduh. */
export async function saveWorkbook(sheets: SheetSpec[], filename: string) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  // Sheet daftar pilihan (disembunyikan) dibuat bila ada dropdown panjang.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let listWs: any = null;
  let listCol = 0;
  const putList = (title: string, values: string[], name?: string): string => {
    if (!listWs) {
      listWs = wb.addWorksheet(LIST_SHEET);
      listWs.state = "hidden";
    }
    const c = colLetter(listCol++);
    listWs.getCell(`${c}1`).value = title;
    listWs.getCell(`${c}1`).font = { bold: true };
    values.forEach((v, i) => (listWs.getCell(`${c}${i + 2}`).value = v));
    const ref = `'${LIST_SHEET}'!$${c}$2:$${c}$${Math.max(values.length + 1, 2)}`;
    if (name) wb.definedNames.add(ref, name);
    return ref;
  };

  sheets.forEach((sh) => {
    const ws = wb.addWorksheet(sh.name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = sh.headers.map((header, i) => ({ header, key: `c${i}`, width: sh.widths[i] ?? 16 }));
    ws.addRows(sh.rows);
    Object.entries(sh.numFmt || {}).forEach(([i, f]) => {
      ws.getColumn(Number(i) + 1).numFmt = f;
    });
    const last = Math.max(LIST_ROWS, sh.rows.length + 1000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const addDv = (i: number, dv: any) => (ws as any).dataValidations.add(`${colLetter(i)}2:${colLetter(i)}${last}`, dv);
    const head = (i: number) => sh.headers[i];
    Object.entries(sh.lists || {}).forEach(([k, opts]) => {
      const i = Number(k);
      addDv(i, {
        type: "list", allowBlank: true, formulae: [`"${opts.join(",")}"`],
        showErrorMessage: true, errorStyle: "stop", errorTitle: head(i), error: `Pilih salah satu: ${opts.join(" / ")}`,
        showInputMessage: true, promptTitle: head(i), prompt: "Pilih dari dropdown."
      });
    });
    Object.entries(sh.rules || {}).forEach(([k, r]) => {
      const i = Number(k);
      const msg = (strict: boolean) =>
        strict
          ? { showErrorMessage: true, errorStyle: "stop", errorTitle: head(i), error: "Nilai harus dipilih dari dropdown." }
          : { showErrorMessage: true, errorStyle: "warning", errorTitle: head(i), error: "Nilai ini belum ada di daftar. Cek ejaannya — klik Yes kalau memang data baru." };
      const prompt = (t: string) => ({ showInputMessage: true, promptTitle: head(i), prompt: (r.hint || t).slice(0, 250) });
      if (r.kind === "list") {
        const vals = uniqSorted(r.values);
        if (vals.length === 0) return;
        const inline = `"${vals.join(",")}"`;
        const formula = inline.length <= 250 && !vals.some((v) => v.includes(",")) ? inline : putList(head(i), vals);
        addDv(i, { type: "list", allowBlank: true, formulae: [formula], ...msg(r.strict), ...prompt(r.strict ? "Pilih dari dropdown." : "Pilih dari dropdown, atau ketik bila data baru.") });
      } else if (r.kind === "dependent") {
        const keys = Object.keys(r.map).filter((p) => (r.map[p] || []).length > 0);
        if (keys.length === 0) return;
        keys.forEach((p) => putList(`${head(r.parentCol)}: ${p}`, uniqSorted(r.map[p]), depName(p)));
        const pc = `$${colLetter(r.parentCol)}2`;
        const f = `INDIRECT("M_"&SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(UPPER(${pc})," ","_"),"-","_"),".","_"),"/","_"),"&","_"),"(","_"),")","_"))`;
        addDv(i, { type: "list", allowBlank: true, formulae: [f], ...msg(r.strict), ...prompt(`Isi ${head(r.parentCol)} dulu, lalu pilih ${head(i)} dari dropdown (atau ketik bila model baru).`) });
      } else if (r.kind === "whole" || r.kind === "decimal") {
        addDv(i, {
          type: r.kind, operator: "between", allowBlank: true, formulae: [r.min, r.max],
          showErrorMessage: true, errorStyle: "stop", errorTitle: head(i), error: `Isi angka ${r.kind === "whole" ? "bulat " : ""}${r.min}–${r.max}.`,
          ...prompt(`Angka ${r.kind === "whole" ? "bulat " : ""}${r.min}–${r.max}.`)
        });
      } else if (r.kind === "unique") {
        const c = colLetter(i);
        addDv(i, {
          type: "custom", allowBlank: true, formulae: [`COUNTIF($${c}$2:$${c}$${last},${c}2)<=1`],
          showErrorMessage: true, errorStyle: "warning", errorTitle: head(i), error: `${head(i)} ini sudah ada di baris lain (dobel).`,
          ...prompt(`${head(i)} tidak boleh dobel.`)
        });
      }
    });
    ws.getRow(1).eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.alignment = { vertical: "middle", horizontal: "left" };
    });
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
