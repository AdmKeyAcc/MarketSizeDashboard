/** Template downloads for the upload types (Data UIO, Data Harga, Master Part, Actual Sales).
 * ExcelJS is imported dynamically so the library is only pulled into the
 * bundle when the user actually clicks "Unduh template". It's used here
 * (instead of @e965/xlsx, used elsewhere in the app) specifically because
 * it can actually write cell styles — @e965/xlsx parses styles but silently
 * drops them when writing, so the header row never came out colored. */

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

export async function downloadUioTemplate() {
  // Hanya baris header (tanpa contoh data) — urutan kolom sama dengan tabel
  // "Detail UIO" di Dashboard. Product wajib terisi; kolom lain boleh kosong.
  await downloadWorkbook(
    "Data UIO",
    [
      {
        Branch: "",
        "Pss Name": "",
        "Cust. Code": "",
        "Cust. Name": "",
        "Cust. Group": "",
        "Cust. Type": "",
        Product: "",
        Model: "",
        "Serial Number": "",
        Year: "",
        "HM/Day": "",
        "Day/Month": "",
        "Month/Year": ""
      }
    ],
    [14, 18, 14, 28, 22, 18, 14, 16, 20, 8, 10, 11, 12],
    "template_data_uio.xlsx",
    true
  );
}

export async function downloadContractPriceTemplate() {
  // Data Harga Kontrak (SCPL) — harga sudah nett. Hanya header.
  await downloadWorkbook(
    "Data Harga Kontrak",
    [{ "Cust. Code": "", "Cust. Name": "", "Cust. Group": "", "Cust. Type": "", "Part Number": "", Harga: "" }],
    [14, 28, 22, 18, 20, 16],
    "template_data_harga_kontrak.xlsx",
    true
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
