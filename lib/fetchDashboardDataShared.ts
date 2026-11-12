import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DashboardData,
  DataMeta,
  Part,
  Customer,
  ActualSalesRow,
  ActualSalesTx,
  ActualSalesYear,
  UioUnit,
  PriceListEntry,
  ActualQtyYear
} from "@/lib/types";
import { buildReferences, type References } from "@/lib/references";

const PAGE_SIZE = 1000;

/**
 * Supabase caps a single `select` at 1000 rows by default. `uio_units` in
 * particular can hold tens of thousands of rows (one per physical unit),
 * so every table here is paged through with `.range()` until a page comes
 * back short — fetching only the first 1000 rows of a 70k-row table would
 * silently make every chart built from it wrong.
 */
export async function fetchAll<T>(
  supabase: SupabaseClient,
  table: string,
  orderBy = "id",
  select = "*"
): Promise<T[]> {
  // .order() is required for pagination to be stable across pages — without
  // it Postgres can return rows in a different order per request, which
  // would silently skip or duplicate rows across the .range() calls below.
  // Halaman diambil beberapa sekaligus (paralel) supaya tabel besar (puluhan ribu baris) cepat termuat;
  // hasil disusun ulang menurut nomor halaman, jadi urutannya tetap sama.
  const PAR = 6;
  const pages: T[][] = [];
  for (let start = 0; ; start += PAR) {
    const batch = await Promise.all(
      Array.from({ length: PAR }, async (_, j) => {
        const from = (start + j) * PAGE_SIZE;
        const { data, error } = await supabase
          .from(table)
          .select(select)
          .order(orderBy, { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw new Error(`${table}: ${error.message}`);
        return (data ?? []) as T[];
      })
    );
    pages.push(...batch);
    if (batch.some((rows) => rows.length < PAGE_SIZE)) break;
  }
  const all: T[] = [];
  for (const rows of pages) {
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}

/** Jumlah baris Actual per part (actual_sales_tx). Isinya sengaja TIDAK dimuat ke dashboard:
 * hasil sinkron dari web Sales bisa ratusan ribu baris (sejak 2018) dan belum ditampilkan di mana pun.
 * Kalau nanti tampilan Part butuh, ambil per tahun/customer sesuai filter, bukan semuanya. */
async function countActualSalesTx(supabase: SupabaseClient): Promise<number> {
  const head = await supabase.from("actual_sales_tx").select("id", { count: "exact", head: true });
  return head.error ? 0 : head.count || 0;
}

/**
 * (Tidak dipakai lagi oleh dashboard — lihat countActualSalesTx.)
 * Actual Sales per transaksi bisa puluhan ribu baris. Halamannya diambil
 * PARALEL (bukan satu-satu) supaya dashboard tidak menunggu puluhan request
 * berurutan. Kalau tabel actual_sales_tx belum dibuat/kosong, hasilnya []
 * dan dashboard jatuh ke tabel actual_sales yang lama.
 */
export async function fetchActualSalesTx(supabase: SupabaseClient): Promise<ActualSalesTx[]> {
  const cols = "year,month,customer_group,customer_name,product,model,part_number,qty,amount";
  const head = await supabase.from("actual_sales_tx").select("id", { count: "exact", head: true });
  if (head.error || !head.count) return [];
  const total = head.count;
  const starts: number[] = [];
  for (let from = 0; from < total; from += PAGE_SIZE) starts.push(from);
  const out: ActualSalesTx[][] = new Array(starts.length);
  const CONCURRENCY = 8;
  for (let i = 0; i < starts.length; i += CONCURRENCY) {
    await Promise.all(
      starts.slice(i, i + CONCURRENCY).map(async (from, k) => {
        const { data, error } = await supabase
          .from("actual_sales_tx")
          .select(cols)
          .order("id", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw new Error(`actual_sales_tx: ${error.message}`);
        out[i + k] = ((data ?? []) as unknown as ActualSalesTx[]).map((r) => ({
          ...r,
          qty: Number(r.qty) || 0,
          amount: Number(r.amount) || 0
        }));
      })
    );
  }
  return out.flat();
}

/** Penanda versi data Actual tahunan (berubah setiap kali sinkron menulis). */
async function actualVersion(supabase: SupabaseClient): Promise<string> {
  const { data } = await supabase.from("app_meta").select("value, updated_at").eq("key", "actual_sales_year").maybeSingle();
  const v = (data?.value ?? {}) as { synced_at?: string };
  return `${v.synced_at ?? ""}|${data?.updated_at ?? ""}`;
}

/** Actual tahunan dibaca dalam beberapa halaman sekaligus. Kalau sinkron otomatis selesai tepat di tengah
 * pembacaan, halaman bisa berisi campuran versi lama & baru — jadi versi dicek sebelum & sesudah, dan dibaca
 * ulang kalau berubah (maks. 3 kali). */
async function fetchActualSalesYear(supabase: SupabaseClient): Promise<ActualSalesYear[]> {
  let rows: ActualSalesYear[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await actualVersion(supabase);
    rows = await fetchActualSalesYearOnce(supabase);
    const after = await actualVersion(supabase);
    if (before === after) break;
  }
  return rows;
}

async function fetchActualSalesYearOnce(supabase: SupabaseClient): Promise<ActualSalesYear[]> {
  // Kolom amount_by_month (rincian bulanan, migration v20) dibaca kalau sudah ada.
  const probe = await supabase.from("actual_sales_year").select("amount_by_month").limit(1);
  const cols = probe.error
    ? "year, ka_type, product, customer_group, customer_name, amount"
    : "year, ka_type, product, customer_group, customer_name, amount, amount_by_month";
  const head = await supabase.from("actual_sales_year").select("id", { count: "exact", head: true });
  // Tabel belum dibuat (migration v12 belum dijalankan) -> anggap kosong, jangan menjatuhkan dashboard.
  if (head.error || !head.count) return [];
  const starts: number[] = [];
  for (let from = 0; from < head.count; from += PAGE_SIZE) starts.push(from);
  const out: ActualSalesYear[][] = new Array(starts.length);
  const CONCURRENCY = 8;
  for (let i = 0; i < starts.length; i += CONCURRENCY) {
    await Promise.all(
      starts.slice(i, i + CONCURRENCY).map(async (from, k) => {
        const { data, error } = await supabase
          .from("actual_sales_year")
          .select(cols)
          .order("id", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw new Error(`actual_sales_year: ${error.message}`);
        out[i + k] = ((data ?? []) as unknown as ActualSalesYear[]).map((r) => ({
          ...r,
          amount: Number(r.amount) || 0,
          amount_by_month: Array.isArray(r.amount_by_month) ? r.amount_by_month.map((v) => Number(v) || 0) : null
        }));
      })
    );
  }
  return out.flat();
}

/** Tabel referensi kecil (product_alias, ka_types, app_settings). Tabel yang belum dibuat
 * atau gagal dibaca dianggap kosong → nilai bawaan di lib/references.ts dipakai. */
export async function fetchReferences(supabase: SupabaseClient): Promise<References> {
  const safe = async <T,>(table: string, select: string): Promise<T[] | null> => {
    const { data, error } = await supabase.from(table).select(select).limit(5000);
    return error ? null : ((data ?? []) as unknown as T[]);
  };
  const [aliasRows, kaRows, settingRows] = await Promise.all([
    safe<{ alias: string | null; product: string | null }>("product_alias", "alias, product"),
    safe<{ name: string | null; sort_order: number | null }>("ka_types", "name, sort_order"),
    safe<{ key: string; value: number | string | null }>("app_settings", "key, value")
  ]);
  return buildReferences(aliasRows, kaRows, settingRows);
}

/** Ringkasan Actual Qty (actual_qty_year, migration v21). Tabel belum ada → kosong. */
async function fetchActualQtyYear(supabase: SupabaseClient): Promise<ActualQtyYear[]> {
  const out: ActualQtyYear[] = [];
  // Kolom Rupiah (migration v23) dibaca kalau sudah ada.
  const probe = await supabase.from("actual_qty_year").select("amount").limit(1);
  const cols = probe.error
    ? "year, customer_group, customer_name, product, qty, qty_by_month"
    : "year, customer_group, customer_name, product, qty, qty_by_month, amount, amount_by_month";
  const hasAmount = !probe.error;
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("actual_qty_year")
      .select(cols)
      .order("year")
      .order("customer_group")
      .order("customer_name")
      .order("product")
      .range(from, from + PAGE_SIZE - 1);
    if (error) return [];
    ((data || []) as unknown as { year: number; customer_group: string | null; customer_name: string | null; product: string; qty: unknown; qty_by_month: unknown; amount?: unknown; amount_by_month?: unknown }[]).forEach((r) =>
      out.push({
        year: Number(r.year),
        customer_group: r.customer_group || "",
        customer_name: r.customer_name || "",
        product: r.product,
        qty: Number(r.qty) || 0,
        qty_by_month: Array.isArray(r.qty_by_month) ? (r.qty_by_month as unknown[]).map((v) => Number(v) || 0) : null,
        amount: hasAmount ? Number(r.amount) || 0 : null,
        amount_by_month: hasAmount && Array.isArray(r.amount_by_month) ? (r.amount_by_month as unknown[]).map((v) => Number(v) || 0) : null
      })
    );
    if (!data || data.length < PAGE_SIZE) break;
  }
  return out;
}

/** Cabang yang tidak dihitung (tabel actual_branch_exclusions — sama dengan sinkron Actual Sales). */
async function fetchExcludedBranches(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.from("actual_branch_exclusions").select("business_area");
  if (error || !data) return [];
  return data.map((r: { business_area: string | null }) => String(r.business_area || "").trim().toUpperCase()).filter(Boolean);
}

export async function fetchDashboardDataWithClient(supabase: SupabaseClient): Promise<DashboardData> {
  const [parts, customers, actualTxCount, actualSalesYear, uioUnitsAll, priceList, metaRows, references, actualQtyYear, excludedBranches] = await Promise.all([
    fetchAll<Part>(supabase, "parts"),
    fetchAll<Customer>(supabase, "customers"),
    countActualSalesTx(supabase),
    fetchActualSalesYear(supabase),
    fetchAll<UioUnit>(supabase, "uio_units"),
    fetchAll<PriceListEntry>(supabase, "price_list"),
    fetchAll<{ key: string; updated_at?: string | null; value: { filename?: string | null; mode?: string | null; ytd_year?: number | null; ytd_month?: string | null; synced_at?: string | null; max_date?: string | null } }>(supabase, "app_meta", "key"),
    fetchReferences(supabase),
    fetchActualQtyYear(supabase),
    fetchExcludedBranches(supabase)
  ]);
  // Cakupan website = cabang PAC. Unit di cabang yang Actual-nya tidak dihitung (MHB: JKT, SBY, SMG, BDG)
  // juga tidak dihitung di Market Size / UIO, supaya Market Size dan Actual Sales membandingkan cabang yang sama.
  const exSet = new Set(excludedBranches);
  const uioUnits = exSet.size > 0 ? uioUnitsAll.filter((u) => !exSet.has(String(u.branch || "").trim().toUpperCase())) : uioUnitsAll;

  const findMeta = (key: string) => metaRows.find((m) => m.key === key)?.value ?? {};
  const updatedAt = (key: string) => metaRows.find((m) => m.key === key)?.updated_at ?? null;

  const meta: DataMeta = {
    kalkulator_filename: (findMeta("kalkulator").filename as string) ?? null,
    kalkulator_updated_at: updatedAt("kalkulator"),
    customers_filename: (findMeta("customers").filename as string) ?? null,
    customers_updated_at: updatedAt("customers"),
    actual_sales_filename: (findMeta("actual_sales").filename as string) ?? null,
    actual_sales_updated_at: updatedAt("actual_sales"),
    uio_units_filename: (findMeta("uio_units").filename as string) ?? null,
    uio_units_updated_at: updatedAt("uio_units"),
    price_list_filename: (findMeta("price_list").filename as string) ?? null,
    price_list_updated_at: updatedAt("price_list"),
    actual_year_filename: (findMeta("actual_sales_year").filename as string) ?? null,
    actual_year_ytd_year: ((findMeta("actual_sales_year") as { ytd_year?: number | null }).ytd_year) ?? null,
    actual_year_ytd_month: ((findMeta("actual_sales_year") as { ytd_month?: string | null }).ytd_month) ?? null,
    actual_year_synced_at: ((findMeta("actual_sales_year") as { synced_at?: string | null }).synced_at) ?? null,
    actual_year_max_date: ((findMeta("actual_sales_year") as { max_date?: string | null }).max_date) ?? null,
    actual_tx_count: actualTxCount,
    price_contract_filename: (findMeta("price_contract").filename as string) ?? null,
    price_contract_updated_at: updatedAt("price_contract"),
    price_non_contract_filename: (findMeta("price_non_contract").filename as string) ?? null,
    price_non_contract_updated_at: updatedAt("price_non_contract"),
    uio_units_mode: (findMeta("uio_units").mode as "replace" | "merge" | null) ?? null,
    kalkulator_mode: (findMeta("kalkulator").mode as "replace" | "merge" | null) ?? null,
    price_contract_mode: (findMeta("price_contract").mode as "replace" | "merge" | null) ?? null,
    price_non_contract_mode: (findMeta("price_non_contract").mode as "replace" | "merge" | null) ?? null,
    price_list_type: ((findMeta("price_list") as { type?: string | null }).type) ?? null,
    excluded_branches: excludedBranches,
    uio_excluded_count: uioUnitsAll.length - uioUnits.length
  };
  const actualSalesTx: ActualSalesTx[] = [];

  // actual_sales (bulanan lama) sudah dihapus — Actual dari actual_sales_year (sinkron web Sales).
  const actualSales: ActualSalesRow[] = [];
  return { parts, customers, actualSales, actualSalesTx, actualSalesYear, actualQtyYear, uioUnits, priceList, meta, references };
}
