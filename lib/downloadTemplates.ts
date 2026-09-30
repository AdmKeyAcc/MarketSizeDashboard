/** Template downloads for the 2 upload types (Data UIO & Data Harga).
 * XLSX is imported dynamically so the library is only pulled into the
 * bundle when the user actually clicks "Unduh template". */

async function downloadWorkbook(
  sheetName: string,
  rows: Record<string, string | number>[],
  colWidths: number[],
  filename: string
) {
  const XLSX = await import("@e965/xlsx");
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = colWidths.map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf: ArrayBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });
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
