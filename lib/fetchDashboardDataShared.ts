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

/**
 * Actual Sales per transaksi bisa puluhan ribu baris. Halamannya diambil
 * PARALEL (bukan satu-satu) supaya dashboard tidak menunggu puluhan request
 * berurutan. Kalau tabel actual_sales_tx belum dibuat/kosong, hasilnya []
 * dan dashboard jatuh ke tabel actual_sales yang lama.
 */
async function fetchActualSalesTx(supabase: SupabaseClient): Promise<ActualSalesTx[]> {
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
          .select("year, ka_type, customer_group, customer_name, amount")
          .order("id", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw new Error(`actual_sales_year: ${error.message}`);
        out[i + k] = ((data ?? []) as unknown as ActualSalesYear[]).map((r) => ({ ...r, amount: Number(r.amount) || 0 }));
      })
    );
  }
  return out.flat();
}

export async function fetchDashboardDataWithClient(supabase: SupabaseClient): Promise<DashboardData> {
  const [parts, uio, assumptions, customers, actualSales, actualSalesTx, actualSalesYear, uioUnits, priceList, metaRows] = await Promise.all([
    fetchAll<Part>(supabase, "parts"),
    fetchAll<UioMaster>(supabase, "uio_master"),
    fetchAll<Assumption>(supabase, "assumptions", "product"),
    fetchAll<Customer>(supabase, "customers"),
    fetchAll<ActualSalesRow>(supabase, "actual_sales"),
    fetchActualSalesTx(supabase),
    fetchActualSalesYear(supabase),
    fetchAll<UioUnit>(supabase, "uio_units"),
    fetchAll<PriceListEntry>(supabase, "price_list"),
    fetchAll<{ key: string; value: { filename?: string | null; ytd_year?: number | null; ytd_month?: string | null } }>(supabase, "app_meta", "key")
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
    actual_year_ytd_month: ((findMeta("actual_sales_year") as { ytd_month?: string | null }).ytd_month) ?? null
  };

  return { parts, uio, assumptions, customers, actualSales, actualSalesTx, actualSalesYear, uioUnits, priceList, meta };
}
