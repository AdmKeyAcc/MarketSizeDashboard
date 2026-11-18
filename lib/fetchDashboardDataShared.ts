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
import { normModel } from "@/lib/calculations";

const PAGE_SIZE = 1000;

/** Ulangi request yang gagal sementara (statement timeout, koneksi putus) — maks. 4 kali dengan jeda bertambah. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function withRetry<R>(label: string, run: () => PromiseLike<{ data: any; error: { message: string } | null }>): Promise<R | null> {
  let last = "";
  for (let i = 0; i < 4; i++) {
    const { data, error } = await run();
    if (!error) return (data ?? null) as R | null;
    last = error.message;
    if (!/timeout|canceling statement|fetch|network|503|502|504/i.test(last)) break;
    await new Promise((r) => setTimeout(r, 600 * (i + 1)));
  }
  throw new Error(`${label}: ${last}`);
}

async function runPool<T>(jobs: (() => Promise<T>)[], par: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(par, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++;
        out[i] = await jobs[i]();
      }
    })
  );
  return out;
}

/**
 * Supabase caps a single `select` at 1000 rows by default. `uio_units` in
 * particular can hold tens of thousands of rows (one per physical unit),
 * so every table here is paged through until a page comes back short —
 * fetching only the first 1000 rows of a 70k-row table would silently make
 * every chart built from it wrong.
 *
 * Tabel ber-`id` diambil per RENTANG id (`id >= a and id < b`), bukan OFFSET: OFFSET besar
 * (mis. baris ke-70.000) membuat Postgres membaca ulang semua baris sebelumnya dan bisa
 * kena "statement timeout" setelah upload besar. Rentang id selalu cepat (pakai primary key),
 * dan beberapa rentang diambil sekaligus (paralel). Request yang timeout diulang otomatis.
 */
export async function fetchAll<T>(
  supabase: SupabaseClient,
  table: string,
  orderBy = "id",
  select = "*"
): Promise<T[]> {
  const PAR = 6;
  if (orderBy === "id") {
    const edge = async (asc: boolean) => {
      const d = await withRetry<{ id: number }[]>(table, () =>
        supabase.from(table).select("id").order("id", { ascending: asc }).limit(1)
      );
      return d && d.length ? Number(d[0].id) : null;
    };
    const [lo, hi] = await Promise.all([edge(true), edge(false)]);
    if (lo === null || hi === null) return [];
    const SPAN = 5000; // lebar rentang id per tugas
    const jobs: (() => Promise<T[]>)[] = [];
    for (let a = lo; a <= hi; a += SPAN) {
      const b = Math.min(a + SPAN, hi + 1);
      jobs.push(async () => {
        const got: T[] = [];
        let from = a;
        for (;;) {
          const rows = ((await withRetry<T[]>(table, () =>
            supabase.from(table).select(select).gte("id", from).lt("id", b).order("id", { ascending: true }).limit(PAGE_SIZE)
          )) ?? []) as T[];
          got.push(...rows);
          if (rows.length < PAGE_SIZE) break;
          from = Number((rows[rows.length - 1] as unknown as { id: number }).id) + 1;
        }
        return got;
      });
    }
    return (await runPool(jobs, PAR)).flat();
  }
  // Tabel tanpa id (mis. app_meta, kecil): OFFSET biasa, urut stabil lewat .order().
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const rows = ((await withRetry<T[]>(table, () =>
      supabase.from(table).select(select).order(orderBy, { ascending: true }).range(from, from + PAGE_SIZE - 1)
    )) ?? []) as T[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}

/**
 * Model yang sama tapi beda penulisan ("MF 4708ST" / "MF4708ST", "S25A D4ER" / "S25A-D4ER")
 * dihitung sebagai satu model (normModel), tapi dulu tetap tampil dua kali di filter, Summary,
 * hierarchy dan Detail UIO. Di sini setiap model diberi satu ejaan tampilan:
 *   1) ejaan yang paling sering dipakai di Master Part, kalau modelnya ada di Master Part;
 *   2) kalau tidak ada, ejaan yang paling sering dipakai di Data UIO.
 * Hanya mengubah data yang DIMUAT ke browser — isi database tidak diubah.
 * (Hitungan actual_sales_tx dihapus: count exact di tabel besar itu kena timeout → error 500 setiap buka.)
 */
export function unifyModelNames<P extends { model?: string | null }, U extends { model?: string | null }>(
  parts: P[],
  uio: U[]
): { parts: P[]; uioUnitsAll: U[] } {
  const tally = (rows: { model?: string | null }[]) => {
    const m = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const raw = String(r.model ?? "").trim();
      if (!raw) continue;
      const k = normModel(raw);
      let c = m.get(k);
      if (!c) m.set(k, (c = new Map()));
      c.set(raw, (c.get(raw) || 0) + 1);
    }
    return m;
  };
  const best = (c: Map<string, number>) =>
    Array.from(c.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  const fromParts = tally(parts);
  const fromUio = tally(uio);
  const pick = new Map<string, string>();
  for (const k of new Set([...fromParts.keys(), ...fromUio.keys()])) {
    const c = fromParts.get(k) || fromUio.get(k)!;
    const spellings = new Set([...(fromParts.get(k)?.keys() || []), ...(fromUio.get(k)?.keys() || [])]);
    if (spellings.size > 1) pick.set(k, best(c));
  }
  if (pick.size === 0) return { parts, uioUnitsAll: uio };
  const fix = <T extends { model?: string | null }>(r: T): T => {
    const raw = String(r.model ?? "").trim();
    const to = raw ? pick.get(normModel(raw)) : undefined;
    return to && to !== r.model ? { ...r, model: to } : r;
  };
  return { parts: parts.map(fix), uioUnitsAll: uio.map(fix) };
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

/** Buang baris Master Part kembar: Product + Model (dinormalkan) + Part Number sama → baris pertama dipakai. */
export function dedupeParts<P extends { product?: string | null; model?: string | null; part_number?: string | null }>(parts: P[]): P[] {
  const seen = new Set<string>();
  return parts.filter((p) => {
    const pn = String(p.part_number ?? "").trim().toUpperCase();
    if (!pn) return true;
    const k = `${String(p.product ?? "").trim().toUpperCase()}|${normModel(p.model)}|${pn}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Kunci Customer Group: huruf besar, spasi rapi, tanpa akhiran "GROUP" / "GRUP" / "GRP". */
export function groupKey(g: string | null | undefined): string {
  return String(g ?? "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s,.\-]*\b(GROUP|GRUP|GRP)\.?$/, "")
    .trim();
}

/**
 * Customer Group yang sama tapi ditulis "X GROUP" / "X" (mis. "BGA GROUP" dan "BGA", "TOLAN TIGA GROUP" dan
 * "TOLAN TIGA") digabung jadi satu group di semua data yang dimuat (UIO, Master Customer, Actual, Harga),
 * supaya filter/Summary tidak memecahnya dan Actual-nya bisa dipasangkan dengan unitnya.
 * Ejaan yang dipakai: ejaan di Actual Sales (web Sales) kalau ada, kalau tidak → yang paling sering di Data UIO.
 * Hanya berlaku kalau KEDUA ejaan memang ada; "BUMA GROUP" yang tidak punya pasangan "BUMA" tidak diubah.
 * Isi database tidak diubah.
 */
export function unifyCustomerGroups<
  U extends { customer_group?: string | null },
  C extends { customer_group?: string | null },
  A extends { customer_group?: string | null },
  Q extends { customer_group?: string | null },
  P extends { customer_group?: string | null }
>(d: { uio: U[]; customers: C[]; actualSalesYear: A[]; actualQtyYear: Q[]; priceList: P[] }) {
  const seen = new Map<string, { actual: Map<string, number>; other: Map<string, number> }>();
  const add = (rows: { customer_group?: string | null }[], actual: boolean) =>
    rows.forEach((r) => {
      const raw = String(r.customer_group ?? "").trim();
      if (!raw) return;
      const k = groupKey(raw);
      if (!k) return;
      let e = seen.get(k);
      if (!e) seen.set(k, (e = { actual: new Map(), other: new Map() }));
      const m = actual ? e.actual : e.other;
      m.set(raw, (m.get(raw) || 0) + 1);
    });
  add(d.actualSalesYear, true);
  add(d.uio, false);
  add(d.customers, false);
  add(d.actualQtyYear, false);
  add(d.priceList, false);
  const top = (m: Map<string, number>) => Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  const pick = new Map<string, string>();
  seen.forEach((e, k) => {
    const all = new Set([...e.actual.keys(), ...e.other.keys()]);
    if (all.size > 1) pick.set(k, top(e.actual) ?? top(e.other)!);
  });
  const fix = <T extends { customer_group?: string | null }>(rows: T[]): T[] =>
    pick.size === 0
      ? rows
      : rows.map((r) => {
          const raw = String(r.customer_group ?? "").trim();
          const to = raw ? pick.get(groupKey(raw)) : undefined;
          return to !== undefined && to !== r.customer_group ? { ...r, customer_group: to } : r;
        });
  return {
    uio: fix(d.uio),
    customers: fix(d.customers),
    actualSalesYear: fix(d.actualSalesYear),
    actualQtyYear: fix(d.actualQtyYear),
    priceList: fix(d.priceList),
    merged: Array.from(pick.entries())
  };
}

export async function fetchDashboardDataWithClient(supabase: SupabaseClient): Promise<DashboardData> {
  const [partsRaw, customersRaw, actualSalesYearRaw, uioUnitsRaw, priceListRaw, metaRows, references, actualQtyYearRaw, excludedBranches] = await Promise.all([
    fetchAll<Part>(supabase, "parts"),
    fetchAll<Customer>(supabase, "customers"),
    fetchActualSalesYear(supabase),
    fetchAll<UioUnit>(supabase, "uio_units"),
    fetchAll<PriceListEntry>(supabase, "price_list"),
    fetchAll<{ key: string; updated_at?: string | null; value: { filename?: string | null; mode?: string | null; ytd_year?: number | null; ytd_month?: string | null; synced_at?: string | null; max_date?: string | null } }>(supabase, "app_meta", "key"),
    fetchReferences(supabase),
    fetchActualQtyYear(supabase),
    fetchExcludedBranches(supabase)
  ]);
  // Nama model yang hanya beda format (spasi / - / _ / /) ditampilkan dengan SATU ejaan.
  const { parts: partsUnified, uioUnitsAll: uioModelFixed } = unifyModelNames(partsRaw, uioUnitsRaw);
  // Part Number yang sama untuk model yang sama cukup dihitung SEKALI. Dulu Master Part yang memuat model dengan
  // dua ejaan ("8FBRE14S" dan "8FBRE14S-", "U50-5S" dan "U50 5S") membuat part-nya terhitung dua kali.
  const parts = dedupeParts(partsUnified);
  // Customer Group "X GROUP" dan "X" (mis. "BGA GROUP" = "BGA") dianggap satu group.
  const groups = unifyCustomerGroups({
    uio: uioModelFixed,
    customers: customersRaw,
    actualSalesYear: actualSalesYearRaw,
    actualQtyYear: actualQtyYearRaw,
    priceList: priceListRaw
  });
  const uioUnitsAll = groups.uio;
  const customers = groups.customers;
  const actualSalesYear = groups.actualSalesYear;
  const actualQtyYear = groups.actualQtyYear;
  const priceList = groups.priceList;
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
