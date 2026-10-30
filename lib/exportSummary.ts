import type { CalcSummaryItem } from "@/lib/types";

type ExportRow = Record<string, string | number>;

/** Builds one plain row (Indonesian column headers) per summary item, in
 * the order columns should appear in the exported sheet. */
function toRow(it: CalcSummaryItem, i: number): ExportRow {
  const r1 = (n: number | undefined) => (typeof n === "number" ? Math.round(n * 10) / 10 : "");
  return {
    No: i + 1,
    Product: it.product,
    "Model Unit": it.model,
    "Part Name": it.partName,
    "Part Number": it.partNumber || "",
    "Tahun UIO": it.year ?? "",
    "Jumlah Customer": it.customers ?? "",
    "UIO (Unit)": it.uio,
    "HM / Day": r1(it.hmDay),
    "Day / Month": r1(it.dayMonth),
    "Month / Year": r1(it.monthYear),
    "Annual HM / Unit": Math.round(it.annualHm),
    "Frekuensi Ganti (HM)": it.freqReplacementHm,
    "Qty / Unit": it.qtyPerUnit,
    "Qty Market Size Setahun": Math.round(it.qtyMarketSize),
    "Harga per Pcs (Rp)": Math.round(it.contractPrice),
    "Sumber Harga": it.priceSource || "",
    "Market Size Setahun (Rp)": Math.round(it.amountMarketSize),
    Ditambahkan: new Date(it.addedAt).toLocaleString("id-ID")
  };
}

/** Exports the added-parts summary as an .xlsx file and triggers a
 * browser download. XLSX is imported dynamically so the library is only
 * pulled into the bundle when the user actually clicks "Ekspor ke Excel". */
export async function exportSummaryToExcel(items: CalcSummaryItem[]) {
  const XLSX = await import("@e965/xlsx");

  const rows: ExportRow[] = items.map(toRow);
  // Baris TOTAL: semua kolom kosong kecuali total Market Size.
  const blank: ExportRow = Object.fromEntries(Object.keys(rows[0] ?? {}).map((k) => [k, ""]));
  rows.push({
    ...blank,
    "Sumber Harga": "TOTAL",
    "Market Size Setahun (Rp)": Math.round(items.reduce((s, it) => s + (it.amountMarketSize || 0), 0))
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [4, 12, 16, 28, 18, 9, 10, 9, 9, 10, 11, 13, 14, 9, 14, 16, 30, 20, 18].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Summary Kalkulator");

  const buf: ArrayBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `summary-kalkulator-market-size-${stamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
