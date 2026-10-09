import type { CalcSummaryItem } from "@/lib/types";

type ExportRow = Record<string, string | number>;

/** Builds one plain row (Indonesian column headers) per summary item, in
 * the order columns should appear in the exported sheet. */
function toRow(it: CalcSummaryItem, i: number): ExportRow {
  return {
    No: i + 1,
    Product: it.product,
    "Model Unit": it.model,
    "Part Name": it.partName,
    "Part Number": it.partNumber || "",
    "Customer": it.customer || "Semua",
    "Qty / Unit": it.qtyPerUnit,
    "Pricelist (Rp)": Math.round(it.pricelist),
    "Frekuensi Ganti (HM)": it.freqReplacementHm,
    "HM / Hari": it.hmDay,
    "UIO (Unit)": it.uio,
    "Diskon (%)": Math.round(it.discount * 100),
    "Annual HM": Math.round(it.annualHm),
    "Qty Market Size": Math.round(it.qtyMarketSize),
    "Contract Price (Rp)": Math.round(it.contractPrice),
    "Amount Market Size (Rp)": Math.round(it.amountMarketSize),
    "Ditambahkan": new Date(it.addedAt).toLocaleString("id-ID")
  };
}

/** Exports the added-parts summary as an .xlsx file and triggers a
 * browser download. XLSX is imported dynamically so the library is only
 * pulled into the bundle when the user actually clicks "Ekspor ke Excel". */
export async function exportSummaryToExcel(items: CalcSummaryItem[]) {
  const XLSX = await import("@e965/xlsx");

  const rows: ExportRow[] = items.map(toRow);
  const total = items.reduce((s, it) => s + (it.amountMarketSize || 0), 0);
  rows.push({
    No: "",
    Product: "",
    "Model Unit": "",
    "Part Name": "",
    "Part Number": "",
    "Customer": "",
    "Qty / Unit": "",
    "Pricelist (Rp)": "",
    "Frekuensi Ganti (HM)": "",
    "HM / Hari": "",
    "UIO (Unit)": "",
    "Diskon (%)": "",
    "Annual HM": "",
    "Qty Market Size": "",
    "Contract Price (Rp)": "TOTAL",
    "Amount Market Size (Rp)": Math.round(total),
    "Ditambahkan": ""
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 4 }, { wch: 12 }, { wch: 16 }, { wch: 28 }, { wch: 16 }, { wch: 30 },
    { wch: 9 }, { wch: 16 }, { wch: 12 }, { wch: 9 }, { wch: 10 },
    { wch: 9 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 18 }
  ];
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
