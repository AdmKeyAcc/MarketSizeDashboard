/**
 * Parser sisi-browser untuk dua upload besar: Master Part dan Actual Sales per
 * transaksi. File dibaca di browser (bukan di server) lalu dikirim ke server
 * dalam potongan kecil, karena batas ukuran request di Vercel (~4,5 MB) tidak
 * cukup untuk file puluhan ribu baris. Bisa membaca .xlsx maupun .csv.
 */
import { canonicalProduct } from "@/lib/calculations";
import { MONTH_ORDER } from "@/lib/types";

export class UploadParseError extends Error {}

export type MasterPartRow = {
  product: string;
  model: string;
  part_name: string;
  part_number: string;
  qty_per_unit: number;
  freq_replacement_hm: number;
  pricelist: number;
  hm_day?: number;
  component?: string | null;
};
export type MasterPartParse = {
  rows: MasterPartRow[];
  skipped: number;
  duplicates: number;
  hasHmDay: boolean;
  hasComponent: boolean;
  sheet: string;
};

export type ActualTxRow = {
  year: number;
  month: string;
  customer_group: string | null;
  customer_name: string | null;
  product: string;
  model: string | null;
  part_number: string | null;
  part_name: string | null;
  qty: number;
  amount: number;
};
export type ActualTxParse = {
  rows: ActualTxRow[];
  skipped: number;
  periods: { year: number; month: string }[];
  sheet: string;
};

const normKey = (k: string) => String(k).trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
function pick(norm: Record<string, unknown>, candidates: string[]): unknown {
  for (const c of candidates) {
    const v = norm[c];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return null;
}
const hasKey = (keys: Set<string>, candidates: string[]) => candidates.some((c) => keys.has(c));
const text = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};
function numOf(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  const s = String(v ?? "")
    .trim()
    .replace(/[Rp\s]/gi, "");
  if (s === "") return NaN;
  // "1.234.567,89" (format Indonesia) atau "1,234,567.89" (format Inggris)
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  let t = s;
  if (hasComma && hasDot) t = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (hasComma) t = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  else if (hasDot && /^\d{1,3}(\.\d{3})+$/.test(s)) t = s.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

const MONTH_ALIASES: Record<string, string> = {
  januari: "Januari", january: "Januari", jan: "Januari",
  februari: "Februari", february: "Februari", feb: "Februari", pebruari: "Februari",
  maret: "Maret", march: "Maret", mar: "Maret",
  april: "April", apr: "April",
  mei: "Mei", may: "Mei",
  juni: "Juni", june: "Juni", jun: "Juni",
  juli: "Juli", july: "Juli", jul: "Juli",
  agustus: "Agustus", august: "Agustus", agu: "Agustus", agt: "Agustus", aug: "Agustus",
  september: "September", sep: "September", sept: "September",
  oktober: "Oktober", october: "Oktober", okt: "Oktober", oct: "Oktober",
  november: "November", nov: "November", nop: "November",
  desember: "Desember", december: "Desember", des: "Desember", dec: "Desember"
};
export function normMonth(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return MONTH_ORDER[v.getMonth()] ?? null;
  const s = String(v).trim().toLowerCase();
  if (/^\d{1,2}$/.test(s)) {
    const n = Number(s);
    return n >= 1 && n <= 12 ? MONTH_ORDER[n - 1] : null;
  }
  return MONTH_ALIASES[s] ?? null;
}

async function readRows(file: File): Promise<{ rows: Record<string, unknown>[]; sheet: string }> {
  const XLSX = await import("@e965/xlsx");
  const buf = await file.arrayBuffer();
  // CSV dibaca sebagai teks apa adanya (raw) supaya angka berformat Indonesia
  // seperti "185.000" tidak salah dibaca sebagai 185 oleh pustaka.
  const isCsv = /\.csv$/i.test(file.name);
  const wb = XLSX.read(buf, { type: "array", cellDates: true, raw: isCsv });
  // Pakai sheet dengan baris terbanyak (file bisa punya beberapa tab).
  let best: { name: string; rows: Record<string, unknown>[] } | null = null;
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: null });
    if (!best || rows.length > best.rows.length) best = { name, rows };
  }
  if (!best || best.rows.length === 0) throw new UploadParseError("File kosong atau tidak terbaca.");
  return { rows: best.rows, sheet: best.name };
}

const COL = {
  product: ["product", "produk", "brand"],
  model: ["modelunit", "model", "modeldescription"],
  partName: ["partname", "namapart", "description", "partdescription"],
  partNumber: ["partnumber", "nomorpart", "nopart"],
  qtyPerUnit: ["qtyperunit", "qtyunit", "qty", "jumlahperunit"],
  freq: ["frekuensiganti", "frekuensigantihm", "frekuensi", "freqreplacement", "freqreplacementhm", "frequency", "frequencyhm"],
  pricelist: ["pricelistrp", "pricelist", "harga", "hargarp", "price"],
  hmDay: ["hmhari", "hmday", "hmperhari", "hmperday", "jamperhari"],
  component: ["komponen", "component"]
};

export async function parseMasterPartFile(file: File): Promise<MasterPartParse> {
  const { rows, sheet } = await readRows(file);
  const keys = new Set(Object.keys(rows[0] || {}).map(normKey));
  const missing: string[] = [];
  if (!hasKey(keys, COL.product)) missing.push("Product");
  if (!hasKey(keys, COL.model)) missing.push("Model Unit");
  if (!hasKey(keys, COL.partNumber)) missing.push("Part Number");
  if (!hasKey(keys, COL.qtyPerUnit)) missing.push("Qty per Unit");
  if (!hasKey(keys, COL.freq)) missing.push("Frekuensi Ganti (HM)");
  if (missing.length > 0) {
    throw new UploadParseError(`Kolom wajib tidak ditemukan: ${missing.join(", ")}. Kolom yang terbaca: ${Object.keys(rows[0] || {}).join(", ")}.`);
  }
  const hasHmDay = hasKey(keys, COL.hmDay);
  const hasComponent = hasKey(keys, COL.component);
  const hasPrice = hasKey(keys, COL.pricelist);

  const map = new Map<string, MasterPartRow>();
  let skipped = 0;
  let duplicates = 0;
  for (const r of rows) {
    const norm: Record<string, unknown> = {};
    Object.keys(r).forEach((k) => (norm[normKey(k)] = r[k]));
    const product = text(pick(norm, COL.product));
    const model = text(pick(norm, COL.model));
    const partNumber = text(pick(norm, COL.partNumber));
    const qty = numOf(pick(norm, COL.qtyPerUnit));
    const freq = numOf(pick(norm, COL.freq));
    if (!product || !model || !partNumber || !Number.isFinite(qty) || !Number.isFinite(freq) || qty < 0 || freq <= 0) {
      skipped++;
      continue;
    }
    const price = hasPrice ? numOf(pick(norm, COL.pricelist)) : 0;
    const row: MasterPartRow = {
      product: canonicalProduct(product),
      model,
      part_name: text(pick(norm, COL.partName)) || partNumber,
      part_number: partNumber,
      qty_per_unit: qty,
      freq_replacement_hm: freq,
      pricelist: Number.isFinite(price) && price > 0 ? price : 0
    };
    if (hasHmDay) {
      const hm = numOf(pick(norm, COL.hmDay));
      row.hm_day = Number.isFinite(hm) && hm > 0 && hm <= 24 ? hm : 8;
    }
    if (hasComponent) row.component = text(pick(norm, COL.component));
    const k = `${row.product}|${row.model}|${row.part_number}`;
    if (map.has(k)) duplicates++;
    map.set(k, row); // baris terakhir menang
  }
  if (map.size === 0) {
    throw new UploadParseError("Tidak ada baris valid. Pastikan Product, Model Unit, Part Number, Qty per Unit, dan Frekuensi Ganti (HM, harus lebih dari 0) terisi.");
  }
  return { rows: Array.from(map.values()), skipped, duplicates, hasHmDay, hasComponent, sheet };
}

const TX = {
  year: ["tahun", "year", "yearinv"],
  month: ["bulan", "month", "monthinv"],
  group: ["customergroup", "custgroup"],
  name: ["customername", "custname", "name1", "customer"],
  product: ["product", "produk", "brand"],
  model: ["modelunit", "model"],
  partNumber: ["partnumber", "nomorpart", "nopart"],
  partName: ["partname", "namapart", "description"],
  qty: ["qty", "quantity", "jumlah", "invoicedquantity"],
  amount: ["amountrp", "amount", "actualsales", "actualsalesrp", "nilai", "penjualan", "sales", "totalrp", "total"]
};

export async function parseActualSalesTxFile(file: File): Promise<ActualTxParse> {
  const { rows, sheet } = await readRows(file);
  const keys = new Set(Object.keys(rows[0] || {}).map(normKey));
  const missing: string[] = [];
  if (!hasKey(keys, TX.year)) missing.push("Tahun");
  if (!hasKey(keys, TX.month)) missing.push("Bulan");
  if (!hasKey(keys, TX.product)) missing.push("Product");
  if (!hasKey(keys, TX.partNumber)) missing.push("Part Number");
  if (!hasKey(keys, TX.qty)) missing.push("Qty");
  if (!hasKey(keys, TX.amount)) missing.push("Amount (Rp)");
  if (missing.length > 0) {
    throw new UploadParseError(`Kolom wajib tidak ditemukan: ${missing.join(", ")}. Kolom yang terbaca: ${Object.keys(rows[0] || {}).join(", ")}.`);
  }
  const out: ActualTxRow[] = [];
  const periods = new Map<string, { year: number; month: string }>();
  let skipped = 0;
  for (const r of rows) {
    const norm: Record<string, unknown> = {};
    Object.keys(r).forEach((k) => (norm[normKey(k)] = r[k]));
    const year = numOf(pick(norm, TX.year));
    const month = normMonth(pick(norm, TX.month));
    const product = text(pick(norm, TX.product));
    const partNumber = text(pick(norm, TX.partNumber));
    const qty = numOf(pick(norm, TX.qty));
    const amount = numOf(pick(norm, TX.amount));
    if (!Number.isFinite(year) || year < 2000 || year > 2100 || !month || !product || !partNumber || !Number.isFinite(qty) || !Number.isFinite(amount)) {
      skipped++;
      continue;
    }
    out.push({
      year,
      month,
      customer_group: text(pick(norm, TX.group)),
      customer_name: text(pick(norm, TX.name)),
      product: canonicalProduct(product),
      model: text(pick(norm, TX.model)),
      part_number: partNumber,
      part_name: text(pick(norm, TX.partName)),
      qty,
      amount
    });
    periods.set(`${year}|${month}`, { year, month });
  }
  if (out.length === 0) {
    throw new UploadParseError("Tidak ada baris valid. Pastikan Tahun, Bulan, Product, Part Number, Qty, dan Amount terisi.");
  }
  return { rows: out, skipped, periods: Array.from(periods.values()), sheet };
}
