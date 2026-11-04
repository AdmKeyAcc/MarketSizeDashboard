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

export type SheetSpec = {
  name: string;
  headers: string[];
  widths: number[];
  rows: (string | number | null)[][];
  /** Format angka per kolom (indeks kolom → format Excel, mis. "#,##0"). */
  numFmt?: Record<number, string>;
  /** Dropdown pilihan per kolom (indeks kolom → daftar pilihan), berlaku untuk baris data. */
  lists?: Record<number, string[]>;
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
/** Baris yang diberi dropdown: semua baris data + cadangan untuk baris baru. */
const LIST_ROWS = 20000;

/** Tulis satu atau beberapa sheet (header berwarna, baris judul dibekukan) lalu unduh. */
export async function saveWorkbook(sheets: SheetSpec[], filename: string) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  sheets.forEach((sh) => {
    const ws = wb.addWorksheet(sh.name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = sh.headers.map((header, i) => ({ header, key: `c${i}`, width: sh.widths[i] ?? 16 }));
    ws.addRows(sh.rows);
    Object.entries(sh.numFmt || {}).forEach(([i, f]) => {
      ws.getColumn(Number(i) + 1).numFmt = f;
    });
    Object.entries(sh.lists || {}).forEach(([i, opts]) => {
      const col = colLetter(Number(i));
      const last = Math.max(LIST_ROWS, sh.rows.length + 1000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ws as any).dataValidations.add(`${col}2:${col}${last}`, {
        type: "list",
        allowBlank: true,
        formulae: [`"${opts.join(",")}"`],
        showErrorMessage: true,
        errorStyle: "stop",
        errorTitle: sh.headers[Number(i)],
        error: `Pilih salah satu: ${opts.join(" / ")}`
      });
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

export const UIO_HEADERS = ["Branch", "Pss Name", "Cust. Code", "Cust. Name", "Cust. Group", "Cust. Type", "Price Type", "Product", "Model", "Serial Number", "Year Inv", "Month Inv", "HM/Day", "Day/Month", "Month/Year"];
export const UIO_WIDTHS = [14, 18, 14, 28, 22, 18, 14, 14, 16, 20, 10, 11, 10, 11, 12];
export const UIO_PRICE_COL = 6;
export const CONTRACT_HEADERS = ["Cust. Code", "Cust. Name", "Cust. Group", "Cust. Type", "Price Type", "Part Number", "Harga"];
export const CONTRACT_WIDTHS = [14, 28, 22, 18, 14, 20, 16];
export const CONTRACT_PRICE_COL = 4;

export async function downloadUioTemplate() {
  // Hanya baris header (tanpa contoh data). Product wajib terisi; kolom lain boleh kosong.
  // Price Type = dropdown Kontrak / SCPL / Non-Kontrak.
  await saveWorkbook(
    [{ name: "Data UIO", headers: UIO_HEADERS, widths: UIO_WIDTHS, rows: [], lists: { [UIO_PRICE_COL]: UIO_PRICE_TYPE_OPTIONS } }],
    "template_data_uio.xlsx"
  );
}

export async function downloadContractPriceTemplate() {
  // Data Harga Kontrak / SCPL — harga sudah nett. Price Type = dropdown Kontrak / SCPL. Hanya header.
  await saveWorkbook(
    [{ name: "Data Harga Kontrak", headers: CONTRACT_HEADERS, widths: CONTRACT_WIDTHS, rows: [], numFmt: { 6: "#,##0" }, lists: { [CONTRACT_PRICE_COL]: CONTRACT_PRICE_TYPE_OPTIONS } }],
    "template_data_harga_kontrak_scpl.xlsx"
  );
}

export async function downloadNonContractPriceTemplate() {
  // Data Harga Non Kontrak — format kolom SAMA dengan template kontrak; harga tertera,
  // sistem otomatis dikurangi 50% saat upload. Hanya header.
  await downloadWorkbook(
    "Data Harga Non Kontrak",
    [{ "Cust. Code": "", "Cust. Name": "", "Cust. Group": "", "Cust. Type": "", "Part Number": "", Harga: "" }],
    [14, 28, 22, 18, 20, 16],
    "template_data_harga_non_kontrak.xlsx",
    true
  );
}

export async function downloadMasterPartTemplate() {
  // Master Part — hubungan part ke Product/Model + Qty per unit & Frekuensi ganti.
  // Harga TIDAK ada di sini (harga dari upload Harga Kontrak / Non Kontrak). Hanya header.
  await downloadWorkbook(
    "Master Part",
    [
      {
        Product: "",
        "Model Unit": "",
        "Part Number": "",
        "Part Name": "",
        "Qty per Unit": "",
        "Frekuensi Ganti (HM)": "",
        "HM per Hari": ""
      }
    ],
    [14, 18, 20, 28, 13, 20, 12],
    "template_master_part.xlsx",
    true
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
