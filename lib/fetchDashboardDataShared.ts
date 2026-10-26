import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DashboardData,
  DataMeta,
  Part,
  UioMaster,
  Assumption,
  Customer,
  ActualSalesRow,
  ActualSalesTx,
  ActualSalesYear,
  UioUnit,
  PriceListEntry
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
async function fetchAll<T>(
  supabase: SupabaseClient,
  table: string,
  orderBy = "id",
  select = "*"
): Promise<T[]> {
  // .order() is required for pagination to be stable across pages — without
  // it Postgres can return rows in a different order per request, which
  // would silently skip or duplicate rows across the .range() calls below.
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .order(orderBy, { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
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

async function fetchActualSalesYear(supabase: SupabaseClient): Promise<ActualSalesYear[]> {
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
          .select("year, ka_type, product, customer_group, customer_name, amount")
          .order("id", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw new Error(`actual_sales_year: ${error.message}`);
        out[i + k] = ((data ?? []) as unknown as ActualSalesYear[]).map((r) => ({ ...r, amount: Number(r.amount) || 0 }));
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

export async function fetchDashboardDataWithClient(supabase: SupabaseClient): Promise<DashboardData> {
  const [parts, uio, assumptions, customers, actualSales, actualTxCount, actualSalesYear, uioUnits, priceList, metaRows, references] = await Promise.all([
    fetchAll<Part>(supabase, "parts"),
    fetchAll<UioMaster>(supabase, "uio_master"),
    fetchAll<Assumption>(supabase, "assumptions", "product"),
    fetchAll<Customer>(supabase, "customers"),
    fetchAll<ActualSalesRow>(supabase, "actual_sales"),
    countActualSalesTx(supabase),
    fetchActualSalesYear(supabase),
    fetchAll<UioUnit>(supabase, "uio_units"),
    fetchAll<PriceListEntry>(supabase, "price_list"),
    fetchAll<{ key: string; value: { filename?: string | null; ytd_year?: number | null; ytd_month?: string | null; synced_at?: string | null; max_date?: string | null } }>(supabase, "app_meta", "key"),
    fetchReferences(supabase)
  ]);

  const findMeta = (key: string) => metaRows.find((m) => m.key === key)?.value ?? {};

  const meta: DataMeta = {
    kalkulator_filename: (findMeta("kalkulator").filename as string) ?? null,
    kalkulator_updated_at: null,
    customers_filename: (findMeta("customers").filename as string) ?? null,
    customers_updated_at: null,
    actual_sales_filename: (findMeta("actual_sales").filename as string) ?? null,
    actual_sales_updated_at: null,
    uio_units_filename: (findMeta("uio_units").filename as string) ?? null,
    uio_units_updated_at: null,
    price_list_filename: (findMeta("price_list").filename as string) ?? null,
    price_list_updated_at: null,
    actual_year_filename: (findMeta("actual_sales_year").filename as string) ?? null,
    actual_year_ytd_year: ((findMeta("actual_sales_year") as { ytd_year?: number | null }).ytd_year) ?? null,
    actual_year_ytd_month: ((findMeta("actual_sales_year") as { ytd_month?: string | null }).ytd_month) ?? null,
    actual_year_synced_at: ((findMeta("actual_sales_year") as { synced_at?: string | null }).synced_at) ?? null,
    actual_year_max_date: ((findMeta("actual_sales_year") as { max_date?: string | null }).max_date) ?? null,
    actual_tx_count: actualTxCount
  };
  const actualSalesTx: ActualSalesTx[] = [];

  return { parts, uio, assumptions, customers, actualSales, actualSalesTx, actualSalesYear, uioUnits, priceList, meta, references };
}
