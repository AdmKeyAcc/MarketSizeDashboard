import { NextResponse } from "next/server";
import * as XLSX from "@e965/xlsx";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { chunkedUpsert } from "@/lib/supabase/bulk";
import { parseKalkulatorWorkbook } from "@/lib/parse/kalkulator";
import { ParseError } from "@/lib/parse/xlsxHelpers";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Tidak ada file yang dikirim." }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "File terlalu besar (maks 15 MB)." }, { status: 413 });
    }

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const { parts, uio, assumptions } = parseKalkulatorWorkbook(wb);

    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();

    // Additive: baris part/model yang cocok (Product+Model+Part Number,
    // atau Product+Model untuk uio_master) diperbarui; part/model baru
    // ditambahkan. Part lama yang tidak ada di file terbaru TETAP ADA
    // (tidak lagi dihapus otomatis) — beda dari sebelumnya yang selalu
    // mengganti seluruh tabel.
    await chunkedUpsert(
      supabase,
      "parts",
      parts.map((p) => ({ ...p, updated_at: now })),
      "product,model,part_number"
    );
    await chunkedUpsert(supabase, "uio_master", uio, "product,model");

    const upAssump = await supabase
      .from("assumptions")
      .upsert(
        assumptions.map((a) => ({ ...a, updated_at: now })),
        { onConflict: "product" }
      );
    if (upAssump.error) throw upAssump.error;

    // Rekam histori: tabel `parts` di atas bertambah terus, jadi total
    // market size di titik upload ini direkam terpisah supaya bisa dilihat
    // tren dari waktu ke waktu. Dihitung dari SELURUH data `parts` yang ada
    // saat ini (setelah merge), bukan cuma baris dari file yang baru saja
    // diupload.
    const { data: allParts, error: allPartsErr } = await supabase
      .from("parts")
      .select("product, amount_market_size");
    if (allPartsErr) throw allPartsErr;

    const byProduct: Record<string, number> = {};
    let totalAmountMarketSize = 0;
    for (const p of allParts ?? []) {
      const amount = (p as { amount_market_size: number | null }).amount_market_size || 0;
      const product = (p as { product: string }).product;
      byProduct[product] = (byProduct[product] || 0) + amount;
      totalAmountMarketSize += amount;
    }
    const insSnapshot = await supabase.from("market_size_snapshots").insert({
      filename: file.name,
      total_amount_market_size: totalAmountMarketSize,
      by_product: byProduct
    });
    if (insSnapshot.error) throw insSnapshot.error;

    await supabase.from("app_meta").upsert({
      key: "kalkulator",
      value: { filename: file.name, row_count: parts.length },
      updated_at: now
    });

    return NextResponse.json({ ok: true, rowCount: parts.length, uioCount: uio.length });
  } catch (err) {
    const message = err instanceof ParseError ? err.message : (err as Error).message || "Gagal memproses file.";
    const status = err instanceof ParseError ? 422 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
