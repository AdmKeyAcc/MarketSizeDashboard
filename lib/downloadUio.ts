import type { UioUnit } from "@/lib/types";
import { UIO_FILTER_LABELS, type UioFilterKey, type UioFilterState } from "@/lib/uioFilter";

export type UioExportNode = { id: string; label: string; depth: number; units: UioUnit[]; children: UioExportNode[] };
export type UioExportCol = { key: string; label: string; num?: boolean; get: (u: UioUnit) => string | number | null };

const NAVY = "FF1E293B";
const SOFT = "FFF1F5F9";

/**
 * Download Detail UIO ke Excel, sama dengan tabel di layar:
 *   - dengan Hierarchy Controls → sheet "Hierarki" (baris bertingkat + grup outline, unit & %),
 *     lalu sheet "Unit" berisi semua unit dengan kolom level hierarki di depan;
 *   - tanpa hierarki → sheet "Unit" saja (urutan sesuai sort tabel).
 * Ikut filter UIO dan pencarian. Sheet "Filter" mencatat filter yang dipakai.
 */
export async function downloadUioXlsx(inp: {
  units: UioUnit[];
  cols: UioExportCol[];
  tree: UioExportNode[];
  levels: { key: string; label: string; of: (u: UioUnit) => string }[];
  filters: UioFilterState;
  search: string;
}) {
  const ExcelJS = (await import("exceljs")).default;
  const { units, cols, tree, levels, filters, search } = inp;
  const wb = new ExcelJS.Workbook();
  const head = (ws: import("exceljs").Worksheet) => {
    ws.getRow(1).eachCell((c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.alignment = { vertical: "middle", wrapText: true };
    });
    ws.getRow(1).height = 22;
  };
  const total = units.length;

  if (levels.length > 0) {
    const ws = wb.addWorksheet("Hierarki", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
    ws.columns = [
      { header: `Hierarchy (${levels.map((l) => l.label).join(" › ")})`, width: 50 },
      { header: "UIO (unit)", width: 14 },
      { header: "% unit", width: 10 }
    ];
    head(ws);
    const walk = (ns: UioExportNode[]) =>
      ns.forEach((n) => {
        const r = ws.addRow([n.label, n.units.length, total > 0 ? n.units.length / total : null]);
        r.outlineLevel = Math.min(n.depth, 7);
        r.getCell(1).alignment = { indent: n.depth };
        r.getCell(2).numFmt = "#,##0";
        r.getCell(3).numFmt = "0.0%";
        if (n.depth === 0) r.eachCell((c) => { c.font = { bold: true }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } }; });
        walk(n.children);
      });
    walk(tree);
    const t = ws.addRow(["Grand Total", total, total > 0 ? 1 : null]);
    t.font = { bold: true };
    t.getCell(2).numFmt = "#,##0";
    t.getCell(3).numFmt = "0.0%";
  }

  // Sheet unit: urutan baris mengikuti hierarki (kalau ada), kolom level di depan.
  const us = wb.addWorksheet("Unit", { views: [{ state: "frozen", ySplit: 1 }] });
  us.columns = [
    ...levels.map((l) => ({ header: l.label, width: 22 })),
    ...cols.map((c) => ({ header: c.label, width: c.num ? 11 : c.key === "customer_name" ? 34 : 18 }))
  ];
  head(us);
  const ordered: UioUnit[] = [];
  if (levels.length > 0) {
    const walk = (ns: UioExportNode[]) => ns.forEach((n) => (n.children.length > 0 ? walk(n.children) : ordered.push(...n.units)));
    walk(tree);
  } else ordered.push(...units);
  ordered.forEach((u) => us.addRow([...levels.map((l) => l.of(u)), ...cols.map((c) => c.get(u) ?? "")]));
  us.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: levels.length + cols.length } };

  const info = wb.addWorksheet("Filter");
  info.columns = [{ width: 22 }, { width: 70 }];
  const put = (k: string, v: string) => (info.addRow([k, v]).getCell(1).font = { bold: true });
  put("Laporan", "Detail UIO");
  put("Jumlah unit", total.toLocaleString("id-ID"));
  put("Level hierarki", levels.length > 0 ? levels.map((l) => l.label).join(" > ") : "Tanpa hierarki (daftar unit)");
  info.addRow([]);
  (Object.keys(UIO_FILTER_LABELS) as UioFilterKey[]).forEach((k) => put(UIO_FILTER_LABELS[k], filters[k].length > 0 ? filters[k].join(", ") : "Semua"));
  put("Pencarian", search.trim() || "-");
  info.addRow([]);
  put("Diunduh", new Date().toLocaleString("id-ID"));

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Detail_UIO_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
