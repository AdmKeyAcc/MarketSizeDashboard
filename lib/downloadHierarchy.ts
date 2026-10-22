import { HIER_LABELS, sortTree, type HierDim, type SortKey, type TreeNodeM, type TreeResultM, type YearVals } from "@/lib/hierarchy";
import type { FilterState } from "@/lib/calculations";

export type HierarchyExportInput = {
  tree: TreeResultM;
  years: number[];
  refYear: number;
  yearLabel: (y: number) => string;
  levels: HierDim[];
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  /** Baris yang sedang terbuka di tabel; baris lain di Excel ikut tersembunyi (bisa dibuka lewat tombol grup 1/2/3). */
  expanded: Set<string>;
  filters: FilterState;
  periodLabel: string;
};

const FILTER_LABELS: [keyof FilterState, string][] = [
  ["tahun", "Tahun"], ["bulan", "Bulan"], ["area", "Branch"], ["sector", "Sector"], ["customerGroup", "Customer Group"],
  ["customerName", "Customer Name"], ["pss", "PSS"], ["tier", "KA Type"], ["product", "Product"],
  ["modelUnit", "Model Unit"], ["partNumber", "Part Number"], ["partName", "Part Name"]
];

const NAVY = "FF1E293B";
const SOFT = "FFF1F5F9";
const GREEN = "FF008000";
const RED = "FFC62828";

/** Download hasil Hierarchy Controls ke Excel: sama dengan tabel di layar (filter, level, urutan, 3 tahun berdampingan),
 * dengan grup baris (outline) seperti laporan dashboard sales. */
export async function downloadHierarchyXlsx(inp: HierarchyExportInput) {
  const ExcelJS = (await import("exceljs")).default;
  const { tree, years, refYear, yearLabel, levels, sortKey, sortDir, expanded, filters, periodLabel } = inp;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Market Size vs Actual", { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
  ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false };

  const headers = ["HIERARKI DATA", `UIO ${refYear}`];
  years.forEach((y) => headers.push(`Market Size ${yearLabel(y)}`, `Actual ${y}`, `% Share ${y}`));
  headers.push(`Variance ${refYear}`);
  ws.columns = headers.map((h, i) => ({ header: h, key: `c${i}`, width: i === 0 ? 48 : h.startsWith("%") ? 12 : 20 }));
  ws.getRow(1).height = 24;
  ws.getRow(1).eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });

  const shareCols: number[] = [];
  const addRow = (label: string, yr: Record<number, YearVals> | undefined, uio: number, depth: number, hidden: boolean, kind: "total" | "node") => {
    const vals: (string | number | null)[] = [label, Math.round(uio)];
    years.forEach((y) => {
      const q = yr?.[y];
      const a = q ? q.actual : null;
      vals.push(q ? Math.round(q.ms) : 0, a === null ? null : Math.round(a), a === null || !q || q.ms <= 0 ? null : a / q.ms);
    });
    const m = yr?.[refYear];
    const variance = m && m.actual !== null ? Math.round(m.actual - m.ms) : null;
    vals.push(variance);
    const row = ws.addRow(vals);
    row.outlineLevel = kind === "total" ? 0 : Math.min(depth, 7);
    row.hidden = hidden;
    const top = kind === "total" || depth === 0;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const isShare = col >= 3 && (col - 3) % 3 === 2 && col < headers.length;
      const isVar = col === headers.length;
      cell.numFmt = isShare ? "0.0%" : "#,##0";
      if (col === 1) {
        cell.alignment = { indent: kind === "total" ? 0 : depth + 1 };
        cell.font = top ? { bold: true } : { color: { argb: "FF334155" } };
      } else {
        cell.font = { bold: top && !isShare };
        if (isVar && typeof cell.value === "number" && cell.value !== 0) cell.font = { bold: top, color: { argb: cell.value > 0 ? GREEN : RED } };
      }
      if (top) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } };
    });
    if (kind === "total") {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = { top: { style: "medium", color: { argb: NAVY } } };
      });
    }
    return row;
  };
  void shareCols;

  const walk = (nodes: TreeNodeM[], hiddenByParent: boolean) => {
    sortTree(nodes, sortKey, sortDir).forEach((n) => {
      addRow(n.label, n.yr, n.uio, n.depth, hiddenByParent, "node");
      if (n.children.length > 0) walk(n.children, hiddenByParent || !expanded.has(n.id));
    });
  };
  walk(tree.roots, false);
  addRow("GRAND TOTAL", tree.totals, tree.totals[tree.mainYear]?.uio ?? 0, 0, false, "total");

  // Sheet 2: filter & parameter yang dipakai, supaya hasil download bisa ditelusuri.
  const info = wb.addWorksheet("Filter");
  info.columns = [{ width: 26 }, { width: 70 }];
  const put = (k: string, v: string, bold = false) => {
    const r = info.addRow([k, v]);
    r.getCell(1).font = { bold: true };
    if (bold) r.getCell(2).font = { bold: true };
  };
  put("Laporan", "Market Size vs Actual Sales");
  put("Tahun acuan", String(refYear));
  put("Tahun ditampilkan", years.join(", "));
  put("Periode", periodLabel);
  put("Level hierarki", levels.map((l) => HIER_LABELS[l]).join(" > "));
  put("Urutan", `${sortKey === "name" ? "Nama" : sortKey === "ms" ? "Market Size" : "Actual"} (${sortDir === "desc" ? "besar ke kecil" : "kecil ke besar"})`);
  info.addRow([]);
  FILTER_LABELS.forEach(([k, label]) => put(label, filters[k].length > 0 ? filters[k].join(", ") : "Semua"));
  info.addRow([]);
  put("Diunduh", new Date().toLocaleString("id-ID"));

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Market_Size_vs_Actual_${refYear}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
