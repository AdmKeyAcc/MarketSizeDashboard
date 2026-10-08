import type { DetailRow } from "@/lib/calculations";

/** Mengekspor baris Detail part (sesuai filter yang sedang dipilih) ke file
 * .xlsx dan memicu unduhan di browser. Pustaka XLSX baru dimuat saat tombol
 * ekspor diklik supaya tidak memberatkan halaman. */
export async function exportDetailToExcel(rows: DetailRow[], filterNote: string) {
  const XLSX = await import("@e965/xlsx");

  const data: Record<string, string | number>[] = rows.map((r, i) => ({
    No: i + 1,
    Product: r.product,
    "Model Unit": r.model,
    "Part Name": r.part_name,
    "Part Number": r.part_number || "",
    "HM / Hari": r.hm_day,
    "Annual HM": Math.round(r.annual_hm),
    "Frekuensi Ganti (HM)": r.freq_replacement_hm,
    "Qty per Unit": r.qty_per_unit,
    "UIO (Unit)": Math.round(r.uio),
    "Price (Rp)": Math.round(r.price),
    "Qty Market Size": Math.round(r.qty_market_size),
    "Market Size (Rp)": Math.round(r.amount_market_size),
    "Actual Qty": Math.round(r.actual_qty),
    "Actual Sales (Rp)": Math.round(r.actual_sales),
    "Market Share (%)": r.market_share === null ? "" : Math.round(r.market_share * 1000) / 10
  }));

  const sum = (f: (r: DetailRow) => number) => Math.round(rows.reduce((s, r) => s + (f(r) || 0), 0));
  data.push({
    No: "",
    Product: "",
    "Model Unit": "",
    "Part Name": "",
    "Part Number": "",
    "HM / Hari": "",
    "Annual HM": "",
    "Frekuensi Ganti (HM)": "",
    "Qty per Unit": "",
    "UIO (Unit)": "",
    "Price (Rp)": "TOTAL",
    "Qty Market Size": sum((r) => r.qty_market_size),
    "Market Size (Rp)": sum((r) => r.amount_market_size),
    "Actual Qty": sum((r) => r.actual_qty),
    "Actual Sales (Rp)": sum((r) => r.actual_sales),
    "Market Share (%)": ""
  });

  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = [
    { wch: 6 }, { wch: 12 }, { wch: 16 }, { wch: 28 }, { wch: 18 },
    { wch: 9 }, { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 10 },
    { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 10 }, { wch: 18 }, { wch: 12 }
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Detail Part");
  const info = XLSX.utils.aoa_to_sheet([
    ["Ekspor Detail Part"],
    ["Waktu ekspor", new Date().toLocaleString("id-ID")],
    ["Jumlah baris", rows.length],
    ["Filter", filterNote || "Tanpa filter tambahan"]
  ]);
  info["!cols"] = [{ wch: 16 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, info, "Info");

  const buf: ArrayBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `detail-part-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
