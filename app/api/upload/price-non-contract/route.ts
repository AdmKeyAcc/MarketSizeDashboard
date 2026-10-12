import { NextResponse } from "next/server";
import * as XLSX from "@e965/xlsx";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { chunkedUpsert } from "@/lib/supabase/bulk";
import { parseNonContractPriceWorkbook } from "@/lib/parse/priceList";
import { ParseError } from "@/lib/parse/xlsxHelpers";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_BYTES = 15 * 1024 * 1024;

/** Data Harga Non Kontrak: harga tertera dikurangi 50% otomatis (price = harga nett, list_price = harga tertera). Disimpan sebagai harga umum (customer_group kosong). */
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
    const { rows, skipped, duplicates } = parseNonContractPriceWorkbook(wb);

    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();

    await chunkedUpsert(
      supabase,
      "price_list",
      rows.map((r) => ({ part_number: r.part_number, customer_group: "", price: r.price, list_price: r.list_price, price_type: "non_contract", customer_code: null, customer_name: null, customer_type: null, source_filename: file.name, uploaded_at: now })),
      "part_number,customer_group"
    );

    await supabase.from("app_meta").upsert({
      key: "price_list",
      value: { filename: file.name, row_count: rows.length, type: "non_contract" },
      updated_at: now
    });

    return NextResponse.json({ ok: true, rowCount: rows.length, skipped, duplicates });
  } catch (err) {
    const message = err instanceof ParseError ? err.message : (err as Error).message || "Gagal memproses file.";
    const status = err instanceof ParseError ? 422 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
