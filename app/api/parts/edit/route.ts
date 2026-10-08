import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { validateEdit, type EditableField } from "@/lib/partsEdit";

export const runtime = "nodejs";

type Body = { partId?: number; changes?: Record<string, unknown> };

/**
 * Menyimpan perubahan satu baris part dari tabel Detail part.
 * HM/Day, Frekuensi ganti, dan Qty per unit disimpan di tabel `parts`;
 * Price disimpan sebagai harga UMUM (customer group kosong) di `price_list`,
 * karena itu sumber harga yang dipakai dashboard.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    if (!body.partId || !Number.isInteger(body.partId)) return NextResponse.json({ error: "partId tidak valid." }, { status: 400 });
    const entries = Object.entries(body.changes || {});
    if (entries.length === 0) return NextResponse.json({ error: "Tidak ada perubahan." }, { status: 400 });

    const clean: Partial<Record<EditableField, number>> = {};
    for (const [field, raw] of entries) {
      const v = validateEdit(field, raw);
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
      clean[field as EditableField] = v.value;
    }

    const supabase = getSupabaseAdmin();
    const { data: part, error: partErr } = await supabase.from("parts").select("*").eq("id", body.partId).single();
    if (partErr || !part) return NextResponse.json({ error: "Part tidak ditemukan." }, { status: 404 });

    // Harga umum yang berlaku sekarang (kalau ada) untuk membandingkan.
    let generalPrice: number | null = null;
    if (part.part_number) {
      const { data: pl } = await supabase
        .from("price_list")
        .select("price")
        .eq("part_number", part.part_number)
        .eq("customer_group", "")
        .maybeSingle();
      generalPrice = pl ? Number(pl.price) : null;
    }
    const current: Record<EditableField, number> = {
      hm_day: Number(part.hm_day) || 8,
      freq_replacement_hm: Number(part.freq_replacement_hm) || 0,
      qty_per_unit: Number(part.qty_per_unit) || 0,
      price: generalPrice ?? (Number(part.pricelist) || 0)
    };

    const changed = (Object.keys(clean) as EditableField[]).filter((f) => clean[f] !== current[f]);
    if (changed.length === 0) return NextResponse.json({ ok: true, changed: [], unchanged: true });
    if (changed.includes("price") && !part.part_number) {
      return NextResponse.json({ error: "Part ini tidak punya Part Number, harganya tidak bisa diubah dari sini." }, { status: 400 });
    }

    const now = new Date().toISOString();
    const partUpdate: Record<string, unknown> = { updated_at: now };
    (["hm_day", "freq_replacement_hm", "qty_per_unit"] as const).forEach((f) => {
      if (changed.includes(f)) partUpdate[f] = clean[f];
    });
    const upd = await supabase.from("parts").update(partUpdate).eq("id", body.partId);
    if (upd.error) throw upd.error;

    if (changed.includes("price")) {
      const up = await supabase
        .from("price_list")
        .upsert(
          { part_number: part.part_number, customer_group: "", price: clean.price, source_filename: "edit dari Detail part", uploaded_at: now },
          { onConflict: "part_number,customer_group" }
        );
      if (up.error) throw up.error;
    }

    return NextResponse.json({ ok: true, changed, values: clean });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gagal menyimpan perubahan.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
