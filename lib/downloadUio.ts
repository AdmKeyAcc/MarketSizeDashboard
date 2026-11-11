import type { UioUnit } from "@/lib/types";
import { UIO_FILTER_LABELS, type UioFilterKey, type UioFilterState } from "@/lib/uioFilter";
import type { HierRow } from "@/lib/xlsxHier";

export type UioExportNode = { id: string; label: string; depth: number; units: UioUnit[]; children: UioExportNode[] };
export type UioExportCol = { key: string; label: string; num?: boolean; get: (u: UioUnit) => string | number | null };

/**
 * Download Detail UIO ke Excel, sama dengan tabel di layar:
 *   - dengan Hierarchy Controls → sheet "UIO" bergaya Laporan Sales (HIERARKI DATA, unit, % unit; baris yang tertutup
 *     di tabel ikut tersembunyi), lalu sheet "Unit" berisi semua unit dengan kolom level hierarki di depan;
 *   - tanpa hierarki → sheet "Unit" saja (urutan sesuai sort tabel).
 * Ikut filter UIO dan pencarian. Sheet "Filter" mencatat filter yang dipakai.
 */
export async function downloadUioXlsx(inp: {
  units: UioUnit[];
  cols: UioExportCol[];
  tree: UioExportNode[];
  levels: { key: string; label: string; of: (u: UioUnit) => string }[];
  expanded: Set<string>;
  filters: UioFilterState;
  search: string;
}) {
  const ExcelJS = (await import("exceljs")).default;
  const { writeHierSheet, writeInfoSheet, saveXlsx } = await import("@/lib/xlsxHier");
  const { units, cols, tree, levels, expanded, filters, search } = inp;
  const wb = new ExcelJS.Workbook();
  const total = units.length;
  const pct = (n: number) => (total > 0 ? n / total : null);

  if (levels.length > 0) {
    const rows: HierRow[] = [];
    const walk = (ns: UioExportNode[], hidden: boolean) =>
      ns.forEach((n) => {
        rows.push({ label: n.label, depth: n.depth, values: [n.units.length, pct(n.units.length)], hidden });
        walk(n.children, hidden || !expanded.has(n.id));
      });
    walk(tree, false);
    writeHierSheet(wb.addWorksheet("UIO"), [{ header: "UIO (unit)", kind: "num" }, { header: "% unit", kind: "pct", width: 12 }], rows, [total, pct(total)]);
  }

  // Sheet unit: urutan baris mengikuti hierarki (kalau ada), kolom level di depan.
  const us = wb.addWorksheet("Unit", { views: [{ state: "frozen", ySplit: 1 }] });
  us.columns = [
    ...levels.map((l) => ({ header: l.label, width: 22 })),
    ...cols.map((c) => ({ header: c.label, width: c.num ? 11 : c.key === "customer_name" ? 34 : 18 }))
  ];
  us.getRow(1).height = 24;
  us.getRow(1).eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  const ordered: UioUnit[] = [];
  if (levels.length > 0) {
    const walk = (ns: UioExportNode[]) => ns.forEach((n) => (n.children.length > 0 ? walk(n.children) : ordered.push(...n.units)));
    walk(tree);
  } else ordered.push(...units);
  ordered.forEach((u) => us.addRow([...levels.map((l) => l.of(u)), ...cols.map((c) => c.get(u) ?? "")]));
  us.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: levels.length + cols.length } };

  writeInfoSheet(wb.addWorksheet("Filter"), [
    ["Laporan", "Detail UIO"],
    ["Jumlah unit", total.toLocaleString("id-ID")],
    ["Level hierarki", levels.length > 0 ? levels.map((l) => l.label).join(" > ") : "Tanpa hierarki (daftar unit)"],
    ["", ""],
    ...(Object.keys(UIO_FILTER_LABELS) as UioFilterKey[]).map((k) => [UIO_FILTER_LABELS[k], filters[k].length > 0 ? filters[k].join(", ") : "Semua"] as [string, string]),
    ["Pencarian", search.trim() || "-"],
    ["", ""],
    ["Diunduh", new Date().toLocaleString("id-ID")]
  ]);
  await saveXlsx(wb, `Detail_UIO_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
