import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DashboardData,
  DataMeta,
  Part,
  UioMaster,
  Assumption,
  Customer,
  ActualSalesRow,
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

export async function fetchDashboardDataWithClient(supabase: SupabaseClient): Promise<DashboardData> {
  const [parts, uio, assumptions, customers, actualSales, uioUnits, priceList, metaRows] = await Promise.all([
    fetchAll<Part>(supabase, "parts"),
    fetchAll<UioMaster>(supabase, "uio_master"),
    fetchAll<Assumption>(supabase, "assumptions", "product"),
    fetchAll<Customer>(supabase, "customers"),
    fetchAll<ActualSalesRow>(supabase, "actual_sales"),
    fetchAll<UioUnit>(supabase, "uio_units"),
    fetchAll<PriceListEntry>(supabase, "price_list"),
    fetchAll<{ key: string; value: { filename?: string | null } }>(supabase, "app_meta", "key")
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
    price_list_updated_at: null
  };

  return { parts, uio, assumptions, customers, actualSales, uioUnits, priceList, meta };
}
