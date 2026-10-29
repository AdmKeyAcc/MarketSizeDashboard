import { NextResponse } from "next/server";
import * as XLSX from "@e965/xlsx";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { modeOf, savePrices } from "@/lib/priceSave";
import { parseContractPriceWorkbook } from "@/lib/parse/priceList";
import { ParseError } from "@/lib/parse/xlsxHelpers";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_BYTES = 15 * 1024 * 1024;

/** Data Harga Kontrak (SCPL): harga sudah nett, disimpan apa adanya per Part Number + Customer Group. */
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
    const { rows, skipped, duplicates } = parseContractPriceWorkbook(wb);

    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();

    const mode = modeOf(form.get("mode"));
    const res = await savePrices(
      supabase,
      "contract",
      rows.map((r) => ({ part_number: r.part_number, customer_group: r.customer_group, price: r.price, list_price: null, price_type: "contract", customer_code: r.customer_code, customer_name: r.customer_name, customer_type: r.customer_type, source_filename: file.name, uploaded_at: now })),
      mode,
      now
    );

    // Per jenis harga (untuk info "upload terakhir" di tiap slot), plus key lama "price_list".
    await supabase.from("app_meta").upsert({ key: "price_contract", value: { filename: file.name, row_count: rows.length, mode, type: "contract" }, updated_at: now });
    await supabase.from("app_meta").upsert({
      key: "price_list",
      value: { filename: file.name, row_count: rows.length, mode, type: "contract" },
      updated_at: now
    });

    return NextResponse.json({ ok: true, rowCount: rows.length, skipped, duplicates, mode, ...res });
  } catch (err) {
    const message = err instanceof ParseError ? err.message : (err as Error).message || "Gagal memproses file.";
    const status = err instanceof ParseError ? 422 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
