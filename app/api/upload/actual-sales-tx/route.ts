import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { MONTH_ORDER } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type Period = { year: number; month: string };
type TxRow = {
  year?: unknown; month?: unknown; customer_group?: unknown; customer_name?: unknown;
  product?: unknown; model?: unknown; part_number?: unknown; part_name?: unknown;
  qty?: unknown; amount?: unknown;
};
type Body = {
  action?: "start" | "rows" | "finish";
  periods?: Period[];
  rows?: TxRow[];
  filename?: string;
  total?: number;
};

const s = (v: unknown) => String(v ?? "").trim();
const orNull = (v: unknown) => s(v) || null;

/**
 * Actual Sales per transaksi (1 baris = 1 customer × part × bulan).
 * Upload ulang aman: pada "start", semua data untuk bulan+tahun yang ada di
 * file dihapus dulu, lalu baris baru dimasukkan ("rows", per potongan) —
 * jadi mengupload bulan yang sama dua kali tidak menggandakan angka,
 * sedangkan bulan lain yang tidak ada di file tidak tersentuh.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();

    if (body.action === "start") {
      const periods = Array.isArray(body.periods) ? body.periods : [];
      if (periods.length === 0 || periods.length > 400) {
        return NextResponse.json({ error: "Periode tidak valid." }, { status: 400 });
      }
      for (const p of periods) {
        if (!Number.isInteger(p.year) || !(MONTH_ORDER as readonly string[]).includes(p.month)) {
          return NextResponse.json({ error: "Periode tidak valid." }, { status: 400 });
        }
        const del = await supabase.from("actual_sales_tx").delete().eq("year", p.year).eq("month", p.month);
        if (del.error) throw del.error;
      }
      return NextResponse.json({ ok: true });
    }

    if (body.action === "finish") {
      await supabase.from("app_meta").upsert({
        key: "actual_sales",
        value: { filename: s(body.filename) || "Actual Sales", row_count: Number(body.total) || 0 },
        updated_at: now
      });
      return NextResponse.json({ ok: true });
    }

    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) return NextResponse.json({ error: "Tidak ada baris yang dikirim." }, { status: 400 });
    if (rows.length > 5000) return NextResponse.json({ error: "Potongan data terlalu besar." }, { status: 413 });

    const clean = rows.map((r) => ({
      year: Number(r.year),
      month: s(r.month),
      customer_group: orNull(r.customer_group),
      customer_name: orNull(r.customer_name),
      product: s(r.product).toUpperCase(),
      model: orNull(r.model),
      part_number: orNull(r.part_number),
      part_name: orNull(r.part_name),
      qty: Number(r.qty) || 0,
      amount: Number(r.amount) || 0,
      source_filename: s(body.filename) || null,
      uploaded_at: now
    }));
    const bad = clean.find((r) => !Number.isInteger(r.year) || !(MONTH_ORDER as readonly string[]).includes(r.month) || !r.product);
    if (bad) return NextResponse.json({ error: "Ada baris dengan Tahun/Bulan/Product tidak valid." }, { status: 400 });

    const ins = await supabase.from("actual_sales_tx").insert(clean);
    if (ins.error) throw ins.error;
    return NextResponse.json({ ok: true, count: clean.length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Gagal memproses data." }, { status: 500 });
  }
}
