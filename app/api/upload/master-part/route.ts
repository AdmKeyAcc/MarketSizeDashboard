import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { chunkedUpsert } from "@/lib/supabase/bulk";

export const runtime = "nodejs";
export const maxDuration = 60;

type Row = {
  product?: unknown; model?: unknown; part_name?: unknown; part_number?: unknown;
  qty_per_unit?: unknown; freq_replacement_hm?: unknown; pricelist?: unknown;
  hm_day?: unknown; component?: unknown;
};
type Body = {
  action?: "rows" | "finish";
  rows?: Row[];
  hasHmDay?: boolean;
  hasComponent?: boolean;
  filename?: string;
  total?: number;
};

const s = (v: unknown) => String(v ?? "").trim();
const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : NaN;
};

/**
 * Master Part: product + model + part number (kunci) dengan qty per unit,
 * frekuensi ganti, pricelist, dan (opsional) HM/Hari & komponen.
 * Sifatnya menambah/memperbarui: part yang sama (Product + Model + Part
 * Number) diperbarui, part baru ditambahkan, part lain TIDAK dihapus.
 * Kolom opsional yang tidak ada di file tidak pernah menimpa nilai lama.
 * File dikirim dari browser dalam potongan (action "rows"), lalu "finish".
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();

    if (body.action === "finish") {
      await supabase.from("app_meta").upsert({
        key: "kalkulator",
        value: { filename: s(body.filename) || "Master Part", row_count: Number(body.total) || 0 },
        updated_at: now
      });
      return NextResponse.json({ ok: true });
    }

    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) return NextResponse.json({ error: "Tidak ada baris yang dikirim." }, { status: 400 });
    if (rows.length > 5000) return NextResponse.json({ error: "Potongan data terlalu besar." }, { status: 413 });

    const clean: Record<string, unknown>[] = [];
    for (const r of rows) {
      const product = s(r.product).toUpperCase();
      const model = s(r.model);
      const partNumber = s(r.part_number);
      const qty = n(r.qty_per_unit);
      const freq = n(r.freq_replacement_hm);
      if (!product || !model || !partNumber || !Number.isFinite(qty) || qty < 0 || !Number.isFinite(freq) || freq <= 0) {
        return NextResponse.json({ error: `Baris tidak valid (${product}/${model}/${partNumber}).` }, { status: 400 });
      }
      const row: Record<string, unknown> = {
        product,
        model,
        part_number: partNumber,
        part_name: s(r.part_name) || partNumber,
        qty_per_unit: qty,
        freq_replacement_hm: freq,
        pricelist: Math.max(0, n(r.pricelist) || 0),
        updated_at: now
      };
      if (body.hasHmDay) {
        const hm = n(r.hm_day);
        row.hm_day = Number.isFinite(hm) && hm > 0 && hm <= 24 ? hm : 8;
      }
      if (body.hasComponent) row.component = s(r.component) || null;
      clean.push(row);
    }

    await chunkedUpsert(supabase, "parts", clean, "product,model,part_number");
    return NextResponse.json({ ok: true, count: clean.length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Gagal memproses data." }, { status: 500 });
  }
}
