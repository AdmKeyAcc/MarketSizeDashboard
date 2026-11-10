/**
 * Laporan Cek Data (Excel) — membantu mencari penyebab angka yang belum masuk akal:
 *   1) Model unit yang tidak ada di Master Part → unitnya tidak menghasilkan Market Size.
 *   2) Customer yang punya Market Size tapi Actual Sales-nya 0 → cek ejaan nama / group di web Sales, atau Part Number.
 *   3) Customer yang punya Actual Sales tapi tidak punya unit di Data UIO → kemungkinan pasangan dari poin 2.
 *   4) Market Share di atas 100% → biasanya data unit belum lengkap (unit lama / model belum di Master Part).
 */
import { bestPartModel, canonicalProduct, normModel, partModelsOf } from "@/lib/calculations";
import { saveWorkbook, type SheetSpec } from "@/lib/downloadTemplates";
import type { CustInfo } from "@/lib/hierarchy";
import type { Part, UioUnit } from "@/lib/types";

export type CheckCustRow = {
  grp: string; cname: string; katype: string; branch: string; product: string;
  uio: number; amount_market_size: number; share_den: number; actual_sales: number; market_share: number | null;
};

const RP = "#,##0";

export async function downloadDataCheck(args: {
  uioUnits: UioUnit[];
  parts: Part[];
  custIndex: CustInfo[];
  rows: CheckCustRow[];
  refYear: number | null;
  periodLabel: string;
}) {
  const { uioUnits, parts, custIndex, rows, refYear, periodLabel } = args;
  const yr = refYear ?? 0;

  // 1) Model tanpa Master Part
  const pm = partModelsOf(parts);
  const miss = new Map<string, { product: string; model: string; units: number; custs: Set<string> }>();
  uioUnits.forEach((u) => {
    const pk = canonicalProduct(u.product || "");
    const model = (u.model || "").trim();
    const models = pm.get(pk);
    if (models && model && bestPartModel(normModel(model), models)) return;
    const k = `${pk}|${model.toUpperCase()}`;
    let e = miss.get(k);
    if (!e) miss.set(k, (e = { product: pk || "(kosong)", model: model || "(kosong)", units: 0, custs: new Set() }));
    e.units++;
    if (u.customer_name) e.custs.add(u.customer_name.trim());
  });
  const missRows = Array.from(miss.values()).sort((a, b) => b.units - a.units);
  const s1: SheetSpec = {
    name: "Model tanpa Master Part",
    headers: ["Product", "Model", "Jumlah unit", "Jumlah customer", "Contoh customer", "Keterangan"],
    widths: [16, 22, 14, 16, 50, 46],
    rows: missRows.map((e) => [
      e.product, e.model, e.units, e.custs.size, Array.from(e.custs).slice(0, 3).join("; "),
      pm.has(e.product) ? "Model belum ada di Master Part" : "Product belum ada di Master Part"
    ]),
    numFmt: { 2: RP, 3: RP }
  };

  // 2) Customer dengan Market Size tapi Actual 0
  const noAct = rows.filter((r) => r.amount_market_size > 0 && r.actual_sales === 0).sort((a, b) => b.amount_market_size - a.amount_market_size);
  const s2: SheetSpec = {
    name: "Customer tanpa Actual",
    headers: ["Customer Group", "Customer Name", "Customer Type", "Branch", "Product", "UIO (unit)", "Market Size /year (Rp)", `Actual Sales ${yr} (Rp)`],
    widths: [30, 42, 20, 14, 22, 12, 22, 18],
    rows: noAct.map((r) => [r.grp, r.cname, r.katype, r.branch, r.product, r.uio, Math.round(r.amount_market_size), 0]),
    numFmt: { 5: RP, 6: RP, 7: RP }
  };

  // 3) Actual tanpa unit di Data UIO
  const actNoUnit = custIndex
    .filter((c) => c.units.length === 0 && (c.actual.get(yr) || 0) > 0)
    .sort((a, b) => (b.actual.get(yr) || 0) - (a.actual.get(yr) || 0));
  const s3: SheetSpec = {
    name: "Actual tanpa unit UIO",
    headers: ["Customer Group (web Sales)", "Customer Name (web Sales)", "Customer Type", `Actual Sales ${yr} (Rp)`, "Keterangan"],
    widths: [30, 44, 20, 20, 60],
    rows: actNoUnit.map((c) => [c.group, c.name, c.ka, Math.round(c.actual.get(yr) || 0), "Belum ada unitnya di Data UIO, atau nama/group di Data UIO ditulis berbeda"]),
    numFmt: { 3: RP }
  };

  // 4) Market Share > 100%
  const over = rows.filter((r) => r.market_share !== null && r.market_share > 1).sort((a, b) => (b.market_share ?? 0) - (a.market_share ?? 0));
  const s4: SheetSpec = {
    name: "Share di atas 100%",
    headers: ["Customer Group", "Customer Name", "Customer Type", "UIO (unit)", `Market Size ${periodLabel} (Rp)`, `Actual Sales ${yr} (Rp)`, "Market Share (%)"],
    widths: [30, 42, 20, 12, 24, 20, 16],
    rows: over.map((r) => [r.grp, r.cname, r.katype, r.uio, Math.round(r.share_den), Math.round(r.actual_sales), Math.round((r.market_share ?? 0) * 1000) / 10]),
    numFmt: { 3: RP, 4: RP, 5: RP }
  };

  const info: SheetSpec = {
    name: "Ringkasan",
    headers: ["Pemeriksaan", "Jumlah baris", "Artinya", "Tindak lanjut"],
    widths: [28, 14, 60, 60],
    rows: [
      ["Model tanpa Master Part", missRows.length, `${missRows.reduce((t, e) => t + e.units, 0).toLocaleString("id-ID")} unit tidak menghasilkan Market Size`, "Tambahkan model & part-nya ke Master Part"],
      ["Customer tanpa Actual", noAct.length, "Customer punya Market Size tapi Actual Sales tahun ini 0", "Cek ejaan nama / group di web Sales, dan apakah part-nya ada di Master Part"],
      ["Actual tanpa unit UIO", actNoUnit.length, "Customer punya Actual Sales tapi tidak ada unitnya di Data UIO", "Cocokkan dengan sheet Customer tanpa Actual (kemungkinan nama beda), atau lengkapi Data UIO"],
      ["Share di atas 100%", over.length, "Actual lebih besar dari Market Size", "Biasanya unit belum lengkap (unit sebelum 2018 / model belum di Master Part)"],
      [`Tahun acuan: ${yr} (${periodLabel})`, null, "Mengikuti filter di halaman Summary", ""]
    ]
  };
  await saveWorkbook([info, s1, s2, s3, s4], `Cek_Data_Market_Size_${yr}.xlsx`, { help: false });
}
