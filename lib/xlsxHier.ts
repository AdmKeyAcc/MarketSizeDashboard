/**
 * Gaya Excel bertingkat yang sama dengan download Laporan Sales (web dashboard Sales):
 *   - kolom A "HIERARKI DATA", header navy huruf putih tebal, baris 1 dibekukan;
 *   - baris level 1 tebal berlatar abu muda, level di bawahnya teks abu tua + indentasi;
 *   - grup baris (outline) di atas, baris anak yang tertutup di tabel ikut tersembunyi (bisa dibuka lewat tombol 1/2/3);
 *   - % hijau kalau naik, merah kalau turun (khusus kolom "growth"); GRAND TOTAL berlatar gelap, garis ganda di atas.
 */
import type { Worksheet } from "exceljs";

/** growth = % berwarna (naik hijau, turun merah); signed = angka berwarna (mis. Variance). */
export type HierColKind = "text" | "num" | "pct" | "growth" | "signed";
export type HierCol = { header: string; kind: HierColKind; width?: number };
export type HierRow = { label: string; depth: number; values: (string | number | null)[]; hidden?: boolean };

const NAVY = "FF1E293B";
const SOFT = "FFF1F5F9";
const DARK = "FF334155";
const GREEN = "FF008000";
const RED = "FFFF0000";

export function writeHierSheet(ws: Worksheet, cols: HierCol[], rows: HierRow[], total: (string | number | null)[] | null) {
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];
  ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
  ws.columns = [{ header: "HIERARKI DATA", width: 45 }, ...cols.map((c) => ({ header: c.header, width: c.width ?? (c.kind === "text" ? 22 : 16) }))];
  const h = ws.getRow(1);
  h.height = 24;
  h.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });

  const fmt = (k: HierColKind) => (k === "pct" || k === "growth" ? "0.0%" : k === "num" || k === "signed" ? "#,##0" : "@");
  const colored = (k: HierColKind | undefined) => k === "growth" || k === "signed";
  rows.forEach((r) => {
    const row = ws.addRow([r.label, ...r.values.map((v) => (v === null || v === undefined ? null : v))]);
    row.outlineLevel = Math.min(r.depth, 7);
    row.hidden = !!r.hidden;
    const top = r.depth === 0;
    row.getCell(1).alignment = { indent: r.depth + 1 };
    row.getCell(1).font = top ? { bold: true } : { color: { argb: DARK } };
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 2);
      if (c.kind !== "text") cell.numFmt = fmt(c.kind);
      const v = cell.value;
      if (colored(c.kind) && typeof v === "number" && v !== 0) cell.font = { bold: top, color: { argb: v > 0 ? GREEN : RED } };
      else cell.font = top ? { bold: c.kind !== "pct" } : { color: { argb: DARK } };
    });
    if (top)
      for (let i = 1; i <= cols.length + 1; i++) row.getCell(i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } };
  });

  if (total) {
    const row = ws.addRow(["GRAND TOTAL", ...total]);
    for (let i = 1; i <= cols.length + 1; i++) {
      const cell = row.getCell(i);
      const c = cols[i - 2];
      if (c && c.kind !== "text") cell.numFmt = fmt(c.kind);
      const v = cell.value;
      cell.font = {
        bold: true,
        color: { argb: colored(c?.kind) && typeof v === "number" && v !== 0 ? (v > 0 ? "FFAAFFAA" : "FFFFAAAA") : "FFFFFFFF" }
      };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK } };
      cell.border = { top: { style: "double", color: { argb: NAVY } } };
    }
  }
}

/** Sheet "Filter": daftar filter & pengaturan yang dipakai, supaya hasil download bisa ditelusuri. */
export function writeInfoSheet(ws: Worksheet, items: [string, string][]) {
  ws.columns = [{ width: 24 }, { width: 80 }];
  items.forEach(([k, v]) => {
    if (!k && !v) {
      ws.addRow([]);
      return;
    }
    ws.addRow([k, v]).getCell(1).font = { bold: true };
  });
}

/** Simpan workbook ExcelJS sebagai file download di browser. */
export async function saveXlsx(wb: { xlsx: { writeBuffer: () => Promise<ArrayBuffer | Uint8Array> } }, filename: string) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
