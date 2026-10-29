import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { DEFAULT_EXCLUDED_BRANCHES, feedInfo, feedMonth, feedYear, type FeedInfo } from "@/lib/salesFeed";
import { fetchReferences } from "@/lib/fetchDashboardDataShared";
import { applyReferences } from "@/lib/references";
import { canonicalProduct } from "@/lib/calculations";
import { MONTH_ORDER } from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Body = { unit?: "info" | "year" | "month"; year?: unknown; month?: unknown; source?: unknown };

const SOURCE = "Sinkron otomatis dari web Sales";
const CHUNK = 1000;
const NO_PRODUCT = "NO PRODUCT";

const productOf = (p: string) => (p ? canonicalProduct(p) : NO_PRODUCT);
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

async function exclusions(admin: SupabaseClient): Promise<string[]> {
  const { data, error } = await admin.from("actual_branch_exclusions").select("business_area");
  // Tabel belum dibuat (migration v14 belum dijalankan) → pakai default yang sama.
  if (error) return DEFAULT_EXCLUDED_BRANCHES;
  return (data || []).map((r: { business_area: string }) => String(r.business_area).trim().toUpperCase()).filter(Boolean);
}

/** Masukkan baris baru dulu (bertanda batch), baru hapus yang lama — kalau gagal di tengah, data lama tetap utuh. */
async function replaceRows(
  admin: SupabaseClient,
  table: "actual_sales_year" | "actual_sales_tx",
  scope: { year: number; month?: string },
  rows: Record<string, unknown>[],
  batchTag: string
) {
  try {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const ins = await admin.from(table).insert(rows.slice(i, i + CHUNK));
      if (ins.error) throw new Error(`Gagal menyimpan ke ${table}: ${ins.error.message}`);
    }
  } catch (err) {
    let q = admin.from(table).delete().eq("year", scope.year).eq("source_filename", batchTag);
    if (scope.month) q = q.eq("month", scope.month);
    await q;
    throw err;
  }
  let del = admin.from(table).delete().eq("year", scope.year).neq("source_filename", batchTag);
  if (scope.month) del = del.eq("month", scope.month);
  const d1 = await del;
  if (d1.error) throw new Error(`Gagal menghapus data lama ${table}: ${d1.error.message}`);
  // Baris lama tanpa source_filename (null) tidak kena .neq di atas.
  let delNull = admin.from(table).delete().eq("year", scope.year).is("source_filename", null);
  if (scope.month) delNull = delNull.eq("month", scope.month);
  await delNull;
  // Tanda batch dirapikan jadi nama sumber yang tetap.
  let ren = admin.from(table).update({ source_filename: SOURCE }).eq("year", scope.year).eq("source_filename", batchTag);
  if (scope.month) ren = ren.eq("month", scope.month);
  await ren;
}

/** Fungsi atomik (migration v19) belum dibuat → pakai cara lama. */
const isMissingFn = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message || ""));

function ytdFrom(info: FeedInfo): { ytd_year: number | null; ytd_month: string | null } {
  if (!info.max_year) return { ytd_year: null, ytd_month: null };
  const d = info.max_date ? new Date(info.max_date) : null;
  const m = d && !Number.isNaN(d.getTime()) && d.getUTCFullYear() === info.max_year ? d.getUTCMonth() : 11;
  return { ytd_year: info.max_year, ytd_month: MONTH_ORDER[m] };
}

/**
 * Sinkron Actual Sales dari tabel `master` di web Sales (lewat fungsi ms_feed).
 * Satu panggilan = satu unit kerja supaya selalu selesai di bawah batas waktu Vercel:
 *   { unit: "info" }                     → rentang data di Sales
 *   { unit: "year",  year }              → isi ulang actual_sales_year untuk tahun itu
 *   { unit: "month", year, month (1-12) } → isi ulang actual_sales_tx (per part) untuk bulan itu
 * Cabang di tabel actual_branch_exclusions tidak ikut dihitung.
 * Dipanggil dari tombol "Sinkron" di modal Upload dan dari jadwal pg_cron.
 */
export async function POST(request: Request) {
  try {
    const body = ((await request.json().catch(() => ({}))) || {}) as Body;
    const admin = getSupabaseAdmin();
    const exclude = await exclusions(admin);

    if (body.unit === "info") {
      const info = await feedInfo(exclude);
      return NextResponse.json({ ok: true, info, exclude });
    }

    const year = Number(body.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: "Tahun tidak valid." }, { status: 400 });
    }
    // Alias product (TYT → TOYOTA, MASSEY FERGUSON → MF, …) dari tabel product_alias.
    applyReferences(await fetchReferences(admin));
    const now = new Date().toISOString();
    const batchTag = `sync:${now}:${Math.random().toString(36).slice(2, 8)}`;

    if (body.unit === "year") {
      const [feedRows, info] = await Promise.all([feedYear(exclude, year), feedInfo(exclude)]);
      const rows = feedRows.map((r) => ({
        year,
        ka_type: r.ka || null,
        customer_group: r.cg || "",
        customer_name: r.cn || "",
        product: productOf(r.p),
        amount: num(r.amt),
        // Rincian bulanan (feed Sales versi baru); null kalau feed lama belum punya.
        amount_by_month: Array.isArray(r.mm) && r.mm.length === 12 ? r.mm.map(num) : null,
        source_filename: batchTag,
        uploaded_at: now
      }));
      const metaValue = { filename: SOURCE, ...ytdFrom(info), synced_at: now, max_date: info.max_date, exclude };

      // Utama: hapus + isi ulang + metadata dalam SATU transaksi (tidak ada jeda data ganda).
      const rpc = await admin.rpc("ms_replace_actual_year", {
        p_year: year,
        p_rows: rows.map(({ year: _y, uploaded_at: _u, ...r }) => ({ ...r, source_filename: SOURCE })),
        p_meta: metaValue
      });
      if (rpc.error && !isMissingFn(rpc.error)) throw new Error(`Gagal menyimpan Actual ${year}: ${rpc.error.message}`);
      if (rpc.error) {
        // Cadangan (migration v19 belum dijalankan): cara lama bertahap.
        // Kolom amount_by_month (v20) mungkin belum ada → buang dari baris supaya insert tidak gagal.
        const hasMonthly = !(await admin.from("actual_sales_year").select("amount_by_month").limit(1)).error;
        const safeRows = hasMonthly ? rows : rows.map(({ amount_by_month: _m, ...r }) => r);
        await replaceRows(admin, "actual_sales_year", { year }, safeRows, batchTag);
        const cnt = await admin.from("actual_sales_year").select("id", { count: "exact", head: true });
        const meta = await admin.from("app_meta").upsert({
          key: "actual_sales_year",
          value: { ...metaValue, row_count: cnt.count ?? rows.length },
          updated_at: now
        });
        if (meta.error) throw meta.error;
      }
      const total = rows.reduce((a, r) => a + r.amount, 0);
      return NextResponse.json({ ok: true, unit: "year", year, rows: rows.length, total });
    }

    if (body.unit === "month") {
      const month = Number(body.month);
      if (!Number.isInteger(month) || month < 1 || month > 12) {
        return NextResponse.json({ error: "Bulan tidak valid (1–12)." }, { status: 400 });
      }
      const monthName = MONTH_ORDER[month - 1];
      const feedRows = await feedMonth(exclude, year, month);
      const rows = feedRows.map((r) => ({
        year,
        month: monthName,
        customer_group: r.cg || null,
        customer_name: r.cn || null,
        product: productOf(r.p),
        model: null,
        part_number: r.pn || null,
        part_name: r.pd || null,
        qty: num(r.qty),
        amount: num(r.amt),
        source_filename: batchTag,
        uploaded_at: now
      }));
      const rpc = await admin.rpc("ms_replace_actual_tx", {
        p_year: year,
        p_month: monthName,
        p_rows: rows.map(({ year: _y, month: _m, model: _mo, uploaded_at: _u, ...r }) => ({ ...r, source_filename: SOURCE })),
        p_meta: { filename: SOURCE, synced_at: now }
      });
      if (rpc.error && !isMissingFn(rpc.error)) throw new Error(`Gagal menyimpan Actual ${monthName} ${year}: ${rpc.error.message}`);
      if (rpc.error) {
        await replaceRows(admin, "actual_sales_tx", { year, month: monthName }, rows, batchTag);
        await admin.from("app_meta").upsert({
          key: "actual_sales",
          value: { filename: SOURCE, synced_at: now },
          updated_at: now
        });
      }
      return NextResponse.json({ ok: true, unit: "month", year, month, rows: rows.length });
    }

    return NextResponse.json({ error: "unit harus info / year / month." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Sinkron gagal." }, { status: 500 });
  }
}
