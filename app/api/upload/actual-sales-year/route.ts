import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type Row = { year?: unknown; ka_type?: unknown; product?: unknown; customer_group?: unknown; customer_name?: unknown; amount?: unknown };
type Body = {
  action?: "start" | "rows" | "finish";
  rows?: Row[];
  filename?: string;
  total?: number;
  ytdYear?: number;
  ytdMonth?: string;
  /** Tahun-tahun yang ada di file. Hanya tahun ini yang dihapus sebelum diisi ulang. */
  years?: unknown[];
};

const s = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
};

/** Upload Actual Sales tahunan bertahap: start = hapus data TAHUN YANG ADA DI FILE saja
 * (tahun lain tetap aman), rows = isi per potongan, finish = catat metadata.
 * Baris boleh membawa `product` (laporan per Product); laporan lama tanpa product tetap diterima. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();

    if (body.action === "start") {
      const years = Array.from(
        new Set((Array.isArray(body.years) ? body.years : []).map((y) => Number(y)).filter((y) => Number.isInteger(y) && y > 1900 && y < 3000))
      );
      if (years.length === 0) {
        return NextResponse.json({ error: "Tahun di file tidak terbaca, upload dibatalkan (tidak ada data yang dihapus)." }, { status: 400 });
      }
      const del = await supabase.from("actual_sales_year").delete().in("year", years);
      if (del.error) throw del.error;
      return NextResponse.json({ ok: true, years });
    }

    if (body.action === "finish") {
      // Info YTD hanya diganti kalau file ini membawa tahun yang sama/lebih baru dari yang tersimpan
      // (upload ulang tahun lama tidak boleh menggeser tahun berjalan).
      const prev = await supabase.from("app_meta").select("value").eq("key", "actual_sales_year").maybeSingle();
      const pv = (prev.data?.value ?? {}) as { ytd_year?: number | null; ytd_month?: string | null };
      const fileYtd = Number.isFinite(Number(body.ytdYear)) ? Number(body.ytdYear) : null;
      const keepPrev = pv.ytd_year != null && (fileYtd === null || pv.ytd_year > fileYtd);
      const cnt = await supabase.from("actual_sales_year").select("id", { count: "exact", head: true });
      const up = await supabase.from("app_meta").upsert({
        key: "actual_sales_year",
        value: {
          filename: s(body.filename) || "Actual Sales",
          row_count: cnt.count ?? (Number(body.total) || 0),
          ytd_year: keepPrev ? pv.ytd_year : fileYtd,
          ytd_month: keepPrev ? pv.ytd_month ?? null : s(body.ytdMonth)
        },
        updated_at: now
      });
      if (up.error) throw up.error;
      return NextResponse.json({ ok: true });
    }

    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) return NextResponse.json({ error: "Tidak ada baris yang dikirim." }, { status: 400 });
    if (rows.length > 5000) return NextResponse.json({ error: "Potongan data terlalu besar." }, { status: 413 });

    const clean = rows
      .map((r) => ({
        year: Number(r.year),
        ka_type: s(r.ka_type),
        product: s(r.product),
        customer_group: s(r.customer_group),
        customer_name: s(r.customer_name),
        amount: Number(r.amount),
        source_filename: s(body.filename),
        uploaded_at: now
      }))
      .filter((r) => Number.isFinite(r.year) && r.customer_group && r.customer_name && Number.isFinite(r.amount));
    if (clean.length > 0) {
      const ins = await supabase.from("actual_sales_year").insert(clean);
      if (ins.error) throw ins.error;
    }
    return NextResponse.json({ ok: true, count: clean.length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Gagal memproses data." }, { status: 500 });
  }
}
