/** Template downloads for the 2 upload types (Data UIO & Data Harga).
 * ExcelJS is imported dynamically so the library is only pulled into the
 * bundle when the user actually clicks "Unduh template". It's used here
 * (instead of @e965/xlsx, used elsewhere in the app) specifically because
 * it can actually write cell styles — @e965/xlsx parses styles but silently
 * drops them when writing, so the header row never came out colored. */

async function downloadWorkbook(
  sheetName: string,
  rows: Record<string, string | number>[],
  colWidths: number[],
  filename: string
) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);

  const headers = Object.keys(rows[0] ?? {});
  ws.columns = headers.map((header, i) => ({ header, key: header, width: colWidths[i] ?? 16 }));
  rows.forEach((row) => ws.addRow(row));

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
  await downloadWorkbook(
    "Data UIO",
    [
      {
        Tahun: 2026,
        Product: "TOYOTA",
        Model: "8FD30",
        "Customer Group": "KA Nasional",
        "Customer Name": "PT Contoh Sejahtera",
        Branch: "Jakarta",
        "Serial Number": "TY8FD30-00123"
      }
    ],
    [8, 12, 14, 18, 24, 14, 20],
    "template_data_uio.xlsx"
  );
}

export async function downloadPriceTemplate() {
  await downloadWorkbook(
    "Data Harga",
    [
      { "Part Number": "TY-OIL-001", "Customer Group": "KA Nasional", Harga: 350000 },
      { "Part Number": "TY-OIL-001", "Customer Group": "", Harga: 420000 }
    ],
    [18, 18, 14],
    "template_data_harga.xlsx"
  );
}
