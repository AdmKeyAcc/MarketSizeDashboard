/**
 * "Download data saat ini": isi database terbaru per jenis data, dalam format yang SAMA
 * dengan template upload — jadi file bisa diedit di Excel lalu di-upload lagi.
 * Data dibaca langsung dari Supabase saat tombol diklik (bukan dari data yang sudah dimuat
 * dashboard), supaya benar-benar posisi terkini.
 */
import { CONTRACT_HEADERS, CONTRACT_PRICE_COL, CONTRACT_WIDTHS, UIO_HEADERS, UIO_PRICE_COL, UIO_WIDTHS, saveWorkbook, type SheetSpec } from "@/lib/downloadTemplates";
import { CONTRACT_PRICE_TYPE_OPTIONS, PRICE_TYPE_LABEL, UIO_PRICE_TYPE_OPTIONS, normPriceType } from "@/lib/priceType";

export type DownloadKind = "uio" | "contract" | "non_contract" | "parts" | "actual";

const today = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const v = (x: unknown): string | number | null => (x === null || x === undefined || x === "" ? null : (x as string | number));
const num = (x: unknown): number | null => {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};
const byText = (...vals: unknown[]) => vals.map((x) => String(x ?? "")).join("\u0000");

type Any = Record<string, unknown>;

const TABLE: Record<DownloadKind, string> = {
  uio: "uio_units",
  contract: "price_list",
  non_contract: "price_list",
  parts: "parts",
  actual: "actual_sales_year"
};
const FILE: Record<DownloadKind, string> = {
  uio: "data_uio",
  contract: "data_harga_kontrak",
  non_contract: "data_harga_non_kontrak",
  parts: "master_part",
  actual: "actual_sales"
};

/** Bentuk sheet dari baris database (fungsi murni — tanpa akses jaringan). */
export function buildSheet(kind: DownloadKind, input: Any[], nonContractDiscount = 0.5): SheetSpec {
  if (kind === "uio") {
    const rows = [...input].sort((a, b) =>
      byText(a.branch, a.customer_name, a.product, a.model, a.serial_number).localeCompare(byText(b.branch, b.customer_name, b.product, b.model, b.serial_number))
    );
    return {
      name: "Data UIO",
      headers: UIO_HEADERS,
      widths: UIO_WIDTHS,
      lists: { [UIO_PRICE_COL]: UIO_PRICE_TYPE_OPTIONS },
      rows: rows.map((r) => [
        v(r.branch), v(r.pss_name), v(r.customer_code), v(r.customer_name), v(r.customer_group), v(r.customer_type),
        (() => {
          const t = normPriceType(r.price_type);
          return t ? PRICE_TYPE_LABEL[t] : null;
        })(),
        v(r.product), v(r.model), v(r.serial_number), num(r.year), num(r.month_inv), num(r.hm_day), num(r.day_month), num(r.month_year)
      ])
    };
  }

  if (kind === "contract" || kind === "non_contract") {
    const contract = kind === "contract";
    const isGroupPrice = (r: Any) => r.price_type === "contract" || r.price_type === "scpl";
    const rows = input
      .filter((r) => isGroupPrice(r) === contract)
      .sort((a, b) => byText(a.customer_group, a.part_number).localeCompare(byText(b.customer_group, b.part_number)));
    return {
      name: contract ? "Data Harga Kontrak" : "Data Harga Non Kontrak",
      headers: contract ? CONTRACT_HEADERS : ["Cust. Code", "Cust. Name", "Cust. Group", "Cust. Type", "Part Number", "Harga"],
      widths: contract ? CONTRACT_WIDTHS : [14, 28, 22, 18, 20, 16],
      lists: contract ? { [CONTRACT_PRICE_COL]: CONTRACT_PRICE_TYPE_OPTIONS } : undefined,
      rows: rows.map((r) => {
        // Non kontrak: tulis HARGA TERTERA (sebelum potongan) supaya upload ulang tidak memotong dua kali.
        const harga = contract
          ? num(r.price)
          : num(r.list_price) ?? (nonContractDiscount < 1 ? Math.round((Number(r.price) || 0) / (1 - nonContractDiscount)) : num(r.price));
        return contract
          ? [v(r.customer_code), v(r.customer_name), v(r.customer_group), v(r.customer_type), r.price_type === "scpl" ? "SCPL" : "Kontrak", v(r.part_number), harga]
          : [v(r.customer_code), v(r.customer_name), null, v(r.customer_type), v(r.part_number), harga];
      }),
      numFmt: contract ? { 6: "#,##0" } : { 5: "#,##0" }
    };
  }

  if (kind === "parts") {
    const rows = [...input].sort((a, b) => byText(a.product, a.model, a.part_number).localeCompare(byText(b.product, b.model, b.part_number)));
    return {
      name: "Master Part",
      headers: ["Product", "Model Unit", "Part Number", "Part Name", "Qty per Unit", "Frekuensi Ganti (HM)", "HM per Hari"],
      widths: [14, 18, 20, 28, 13, 20, 12],
      rows: rows.map((r) => [v(r.product), v(r.model), v(r.part_number), v(r.part_name), num(r.qty_per_unit), num(r.freq_replacement_hm), num(r.hm_day)])
    };
  }

  // Actual Sales (hasil sinkron web Sales) — untuk dicek/dicocokkan, tidak untuk di-upload.
  const rows = [...input].sort(
    (a, b) => Number(a.year) - Number(b.year) || byText(a.ka_type, a.customer_group, a.customer_name, a.product).localeCompare(byText(b.ka_type, b.customer_group, b.customer_name, b.product))
  );
  const bulan = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return {
    name: "Actual Sales",
    headers: ["Year", "Customer Type", "Customer Group", "Customer Name", "Product", "Total (Rp)", ...bulan],
    widths: [8, 18, 22, 30, 14, 16, ...bulan.map(() => 13)],
    rows: rows.map((r) => {
      const mm = Array.isArray(r.amount_by_month) ? (r.amount_by_month as unknown[]).map((x) => Number(x) || 0) : null;
      return [num(r.year), v(r.ka_type), v(r.customer_group), v(r.customer_name), v(r.product), num(r.amount), ...(mm && mm.length === 12 ? mm : bulan.map(() => null))];
    }),
    numFmt: Object.fromEntries([5, ...bulan.map((_, i) => 6 + i)].map((i) => [i, "#,##0"]))
  };
}

/** Mengunduh satu jenis data (dibaca langsung dari Supabase). Mengembalikan jumlah baris yang ditulis. */
export async function downloadCurrentData(kind: DownloadKind): Promise<number> {
  const { supabaseBrowser } = await import("@/lib/supabase/client");
  const { fetchAll, fetchReferences } = await import("@/lib/fetchDashboardDataShared");
  const rows = await fetchAll<Any>(supabaseBrowser, TABLE[kind]);
  const discount = kind === "non_contract" ? (await fetchReferences(supabaseBrowser)).settings.non_contract_discount : 0.5;
  const sheet = buildSheet(kind, rows, discount);
  await saveWorkbook([sheet], `${FILE[kind]}_saat_ini_${today()}.xlsx`);
  return sheet.rows.length;
}
