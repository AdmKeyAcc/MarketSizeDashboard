import { HIER_LABELS, sortTree, type HierDim, type SortKey, type TreeNodeM, type TreeResultM, type YearVals } from "@/lib/hierarchy";
import type { FilterState } from "@/lib/calculations";
import type { HierCol, HierRow } from "@/lib/xlsxHier";

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
  ["tahun", "Year"], ["bulan", "Month"], ["area", "Branch"], ["customerGroup", "Customer Group"],
  ["customerName", "Customer Name"], ["pss", "PSS"], ["tier", "Customer Type"], ["product", "Product"],
  ["modelUnit", "Model Unit"], ["partNumber", "Part Number"], ["partName", "Part Name"]
];

/** Download hasil Hierarchy Controls ke Excel: sama dengan tabel di layar (filter, level, urutan, 3 tahun berdampingan),
 * dengan gaya & grup baris (outline) seperti download Laporan Sales di web dashboard Sales. */
export async function downloadHierarchyXlsx(inp: HierarchyExportInput) {
  const ExcelJS = (await import("exceljs")).default;
  const { writeHierSheet, writeInfoSheet, saveXlsx } = await import("@/lib/xlsxHier");
  const { tree, years, refYear, yearLabel, levels, sortKey, sortDir, expanded, filters, periodLabel } = inp;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Market Size vs Actual");

  const cols: HierCol[] = [{ header: `UIO ${refYear}`, kind: "num" }];
  years.forEach((y) => cols.push({ header: `Market Size ${yearLabel(y)}`, kind: "num", width: 20 }, { header: `Actual ${y}`, kind: "num", width: 20 }, { header: `% Share ${y}`, kind: "pct", width: 12 }));
  cols.push({ header: `Variance ${refYear}`, kind: "signed", width: 20 });
  const valsOf = (yr: Record<number, YearVals> | undefined, uio: number) => {
    const vals: (number | null)[] = [Math.round(uio)];
    years.forEach((y) => {
      const q = yr?.[y];
      const a = q ? q.actual : null;
      vals.push(q ? Math.round(q.ms) : 0, a === null ? null : Math.round(a), a === null || !q || q.ms <= 0 ? null : a / q.ms);
    });
    const m = yr?.[refYear];
    vals.push(m && m.actual !== null ? Math.round(m.actual - m.ms) : null);
    return vals;
  };

  const rows: HierRow[] = [];
  const walk = (nodes: TreeNodeM[], hidden: boolean) => {
    sortTree(nodes, sortKey, sortDir).forEach((n) => {
      rows.push({ label: n.label, depth: n.depth, values: valsOf(n.yr, n.uio), hidden });
      if (n.children.length > 0) walk(n.children, hidden || !expanded.has(n.id));
    });
  };
  walk(tree.roots, false);
  writeHierSheet(ws, cols, rows, valsOf(tree.totals, tree.totals[tree.mainYear]?.uio ?? 0));

  // Sheet 2: filter & parameter yang dipakai, supaya hasil download bisa ditelusuri.
  writeInfoSheet(wb.addWorksheet("Filter"), [
    ["Laporan", "Market Size vs Actual Sales"],
    ["Tahun acuan", String(refYear)],
    ["Tahun ditampilkan", years.join(", ")],
    ["Periode", periodLabel],
    ["Level hierarki", levels.map((l) => HIER_LABELS[l]).join(" > ")],
    ["Urutan", `${sortKey === "name" ? "Name" : sortKey === "ms" ? "Market Size" : "Actual"} (${sortDir === "desc" ? "besar ke kecil" : "kecil ke besar"})`],
    ["", ""],
    ...FILTER_LABELS.map(([k, label]) => [label, filters[k].length > 0 ? filters[k].join(", ") : "Semua"] as [string, string]),
    ["", ""],
    ["Diunduh", new Date().toLocaleString("id-ID")]
  ]);
  await saveXlsx(wb, `Market_Size_vs_Actual_${refYear}.xlsx`);
}
