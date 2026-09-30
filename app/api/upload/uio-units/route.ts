import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import * as XLSX from "@e965/xlsx";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { chunkedUpsert } from "@/lib/supabase/bulk";
import { parseUioUnitsWorkbook, type UioUnitParsed } from "@/lib/parse/uioUnits";
import { ParseError } from "@/lib/parse/xlsxHelpers";

export const runtime = "nodejs";
// File populasi UIO bisa puluhan ribu baris, jadi proses upload-nya diberi
// waktu lebih lama. Catatan: paket Vercel Hobby (gratis) tetap membatasi
// durasi function ke ~60 detik apa pun nilai di sini — kalau file sangat
// besar (puluhan ribu baris) timeout di Hobby plan, upgrade ke Pro atau
// jalankan lewat scripts/seed.mjs sebagai alternatif dari command line.
export const maxDuration = 300;

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB — populasi unit bisa puluhan ribu baris

const PLACEHOLDER_SERIALS = new Set(["-", "", "N/A", "NA", "TIDAK ADA", "NAN", "NONE", "#N/A"]);

function isRealSerial(s: string | null): boolean {
  if (!s) return false;
  const norm = s.trim().toUpperCase();
  return norm.length >= 3 && !PLACEHOLDER_SERIALS.has(norm);
}

/**
 * Serial Number adalah kunci dedup satu unit fisik. Banyak baris lama tidak
 * punya serial number valid (kosong, "-", "TIDAK ADA", dst) — baris begini
 * TIDAK bisa dianggap "unit yang sama" hanya karena serial-nya sama-sama
 * kosong, jadi dapat kunci acak supaya selalu masuk sebagai baris baru
 * (tidak menimpa unit lain yang kebetulan juga tidak punya serial).
 */
function dedupeKeyFor(row: UioUnitParsed): string {
  if (isRealSerial(row.serial_number)) {
    return `${row.product ?? ""}::${row.serial_number!.trim().toUpperCase()}`;
  }
  return `no-serial::${randomUUID()}`;
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Tidak ada file yang dikirim." }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "File terlalu besar (maks 25 MB)." }, { status: 413 });
    }

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const { rows, skipped, sheetName } = parseUioUnitsWorkbook(wb);

    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();

    const withKeys = rows.map((r) => ({
      dedupe_key: dedupeKeyFor(r),
      year: r.year,
      product: r.product,
      model: r.model,
      customer_group: r.customer_group,
      customer_name: r.customer_name,
      branch: r.branch,
      serial_number: r.serial_number,
      engine_serial_number: r.engine_serial_number,
      source_filename: file.name,
      uploaded_at: now
    }));

    // File populasi bisa puluhan ribu baris — chunk lebih besar di sini
    // (dibanding default 500) supaya tidak terlalu banyak roundtrip.
    await chunkedUpsert(supabase, "uio_units", withKeys, "dedupe_key", 2000);

    // Histori: total unit & breakdown per tahun+product SETELAH merge, jadi
    // "UIO Februari 300, Maret 350" bisa dilihat trennya dari snapshot demi
    // snapshot tanpa perlu merekonstruksi ulang dari uio_units tiap saat.
    const { data: allUnits, error: allUnitsErr } = await supabase
      .from("uio_units")
      .select("year, product");
    if (allUnitsErr) throw allUnitsErr;

    const byYearProduct: Record<string, Record<string, number>> = {};
    for (const u of allUnits ?? []) {
      const row = u as { year: number | null; product: string | null };
      const yearKey = row.year !== null ? String(row.year) : "unknown";
      const product = row.product || "unknown";
      byYearProduct[yearKey] = byYearProduct[yearKey] || {};
      byYearProduct[yearKey][product] = (byYearProduct[yearKey][product] || 0) + 1;
    }
    const insSnapshot = await supabase.from("uio_snapshots").insert({
      filename: file.name,
      total_units: (allUnits ?? []).length,
      by_year_product: byYearProduct
    });
    if (insSnapshot.error) throw insSnapshot.error;

    await supabase.from("app_meta").upsert({
      key: "uio_units",
      value: { filename: file.name, row_count: rows.length, sheet: sheetName },
      updated_at: now
    });

    return NextResponse.json({ ok: true, rowCount: rows.length, skipped, sheet: sheetName });
  } catch (err) {
    const message = err instanceof ParseError ? err.message : (err as Error).message || "Gagal memproses file.";
    const status = err instanceof ParseError ? 422 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
