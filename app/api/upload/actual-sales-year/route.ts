import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { MONTH_ORDER } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type YearRow = { year?: unknown; ka_type?: unknown; customer_group?: unknown; customer_name?: unknown; amount?: unknown };
type Body = {
  action?: "start" | "rows" | "finish";
  rows?: YearRow[];
  filename?: string;
  total?: number;
  ytdYear?: number | null;
  ytdMonth?: string | null;
};

const s = (v: unknown) => String(v ?? "").trim();

/**
 * Actual Sales tahunan per customer (laporan 3 tingkat KA Type > Customer Group > Customer).
 * File berisi SELURUH riwayat (2018 dst), jadi upload bersifat mengganti total:
 * pada "start" isi tabel dihapus, lalu baris baru dimasukkan per potongan.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();

    if (body.action === "start") {
      const del = await supabase.from("actual_sales_year").delete().gte("id", 0);
      if (del.error) throw del.error;
      return NextResponse.json({ ok: true });
    }

    if (body.action === "finish") {
      const ytdMonth = s(body.ytdMonth);
      const ytdYear = Number(body.ytdYear);
      const valid = (MONTH_ORDER as readonly string[]).includes(ytdMonth) && Number.isInteger(ytdYear);
      const up = await supabase.from("app_meta").upsert({
        key: "actual_sales_year",
        value: {
          filename: s(body.filename) || "Laporan Sales",
          row_count: Number(body.total) || 0,
          ytd_year: valid ? ytdYear : null,
          ytd_month: valid ? ytdMonth : null
        },
        updated_at: now
      });
      if (up.error) throw up.error;
      return NextResponse.json({ ok: true });
    }

    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) return NextResponse.json({ error: "Tidak ada baris yang dikirim." }, { status: 400 });
    if (rows.length > 5000) return NextResponse.json({ error: "Potongan data terlalu besar." }, { status: 413 });

    const clean = rows.map((r) => ({
      year: Number(r.year),
      ka_type: s(r.ka_type).toUpperCase() || null,
      customer_group: s(r.customer_group),
      customer_name: s(r.customer_name),
      amount: Number(r.amount) || 0,
      source_filename: s(body.filename) || null,
      uploaded_at: now
    }));
    const bad = clean.find((r) => !Number.isInteger(r.year) || r.year < 2000 || r.year > 2100 || !r.customer_name);
    if (bad) return NextResponse.json({ error: "Ada baris dengan Tahun atau Customer tidak valid." }, { status: 400 });

    const ins = await supabase.from("actual_sales_year").insert(clean);
    if (ins.error) throw ins.error;
    return NextResponse.json({ ok: true, count: clean.length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Gagal memproses data." }, { status: 500 });
  }
}
