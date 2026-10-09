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

export async function downloadMasterPartTemplate() {
  await downloadWorkbook(
    "Master Part",
    [
      {
        Product: "TOYOTA",
        "Model Unit": "8FD30",
        "Part Name": "OIL FILTER",
        "Part Number": "04152-YZZA1",
        "Qty per Unit": 1,
        "Frekuensi Ganti (HM)": 250,
        "Pricelist (Rp)": 185000,
        "HM per Hari": 8,
        Komponen: "RPL"
      },
      {
        Product: "PERKINS",
        "Model Unit": "1104A-44TG2",
        "Part Name": "FUEL FILTER",
        "Part Number": "26560201",
        "Qty per Unit": 1,
        "Frekuensi Ganti (HM)": 500,
        "Pricelist (Rp)": 260000,
        "HM per Hari": 8,
        Komponen: "RPL"
      }
    ],
    [14, 16, 26, 18, 13, 20, 16, 12, 12],
    "template_master_part.xlsx"
  );
}

export async function downloadActualSalesTemplate() {
  await downloadWorkbook(
    "Actual Sales",
    [
      {
        Tahun: 2026,
        Bulan: "Januari",
        "Customer Group": "KA Nasional",
        "Customer Name": "PT Contoh Sejahtera",
        Product: "TOYOTA",
        "Model Unit": "8FD30",
        "Part Number": "04152-YZZA1",
        "Part Name": "OIL FILTER",
        Qty: 2,
        "Amount (Rp)": 370000
      },
      {
        Tahun: 2026,
        Bulan: "Februari",
        "Customer Group": "OTHERS",
        "Customer Name": "PT Contoh Makmur",
        Product: "PERKINS",
        "Model Unit": "1104A-44TG2",
        "Part Number": "26560201",
        "Part Name": "FUEL FILTER",
        Qty: 1,
        "Amount (Rp)": 260000
      }
    ],
    [8, 12, 18, 24, 12, 16, 18, 22, 8, 14],
    "template_actual_sales.xlsx"
  );
}
