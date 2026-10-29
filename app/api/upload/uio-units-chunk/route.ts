import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { uioSerialKey } from "@/lib/uioKey";

export const runtime = "nodejs";
export const maxDuration = 60;

type Row = {
  year?: unknown; product?: unknown; model?: unknown; customer_group?: unknown; customer_name?: unknown; branch?: unknown;
  serial_number?: unknown; pss_name?: unknown; customer_code?: unknown; customer_type?: unknown;
  hm_day?: unknown; day_month?: unknown; month_year?: unknown; month_inv?: unknown;
};
type Body = {
  action?: "start" | "rows" | "finish";
  rows?: Row[];
  filename?: string;
  total?: number;
  sheet?: string;
  replace?: boolean;
  /** "replace" = ganti semua (default); "merge" = tambah / perbarui per Serial Number. */
  mode?: "replace" | "merge";
};
const s = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
};
const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

/** Serial Number valid = kunci satu unit fisik; tanpa serial valid dapat kunci acak (selalu baris baru). */
function dedupeKey(product: string | null, serial: string | null): string {
  return uioSerialKey(product, serial) ?? `no-serial::${randomUUID()}`;
}

/** Upload Data UIO bertahap (file dibaca di browser, dikirim per potongan supaya tidak kena batas ukuran request Vercel). */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();

    if (body.action === "start") {
      if (body.replace) {
        const del = await supabase.from("uio_units").delete().gte("id", 0);
        if (del.error) throw del.error;
      }
      return NextResponse.json({ ok: true });
    }

    if (body.action === "finish") {
      // Jumlah unit di database (mode tambah/perbarui: bukan jumlah baris file).
      const cnt = await supabase.from("uio_units").select("id", { count: "exact", head: true });
      const up = await supabase.from("app_meta").upsert({
        key: "uio_units",
        value: {
          filename: s(body.filename) || "Data UIO",
          row_count: cnt.error ? Number(body.total) || 0 : cnt.count ?? 0,
          uploaded_rows: Number(body.total) || 0,
          mode: body.mode === "merge" ? "merge" : "replace",
          sheet: s(body.sheet)
        },
        updated_at: now
      });
      if (up.error) throw up.error;
      return NextResponse.json({ ok: true, rowCount: cnt.error ? null : cnt.count ?? null });
    }

    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) return NextResponse.json({ error: "Tidak ada baris yang dikirim." }, { status: 400 });
    if (rows.length > 5000) return NextResponse.json({ error: "Potongan data terlalu besar." }, { status: 413 });

    // Dalam satu potongan, key yang sama tidak boleh muncul dua kali (upsert menolaknya): ambil yang terakhir.
    const byKey = new Map<string, Record<string, unknown>>();
    rows.forEach((r) => {
      const product = s(r.product)?.toUpperCase() ?? null;
      if (!product) return;
      const serial = s(r.serial_number);
      const validKey = uioSerialKey(product, serial);
      // Mode tambah/perbarui: unit tanpa Serial Number valid tidak bisa dicocokkan → tidak disimpan (mencegah data ganda).
      if (body.mode === "merge" && !validKey) return;
      const key = validKey ?? dedupeKey(product, serial);
      byKey.set(key, {
        dedupe_key: key,
        year: n(r.year),
        month_inv: (() => {
          const m = n(r.month_inv);
          return m !== null && Number.isInteger(m) && m >= 1 && m <= 12 ? m : null;
        })(),
        product,
        model: s(r.model),
        customer_group: s(r.customer_group),
        customer_name: s(r.customer_name),
        branch: s(r.branch),
        serial_number: serial,
        pss_name: s(r.pss_name),
        customer_code: s(r.customer_code),
        customer_type: s(r.customer_type),
        hm_day: n(r.hm_day),
        day_month: n(r.day_month),
        month_year: n(r.month_year),
        source_filename: s(body.filename),
        uploaded_at: now
      });
    });
    const clean = Array.from(byKey.values());
    if (clean.length > 0) {
      const up = await supabase.from("uio_units").upsert(clean, { onConflict: "dedupe_key" });
      if (up.error) throw up.error;
    }
    return NextResponse.json({ ok: true, count: clean.length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Gagal memproses data." }, { status: 500 });
  }
}
