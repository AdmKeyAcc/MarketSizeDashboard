import { NextResponse } from "next/server";
import * as XLSX from "@e965/xlsx";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { chunkedUpsert } from "@/lib/supabase/bulk";
import { parseCustomerWorkbook } from "@/lib/parse/customers";
import { ParseError } from "@/lib/parse/xlsxHelpers";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_BYTES = 15 * 1024 * 1024;

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
    const customers = parseCustomerWorkbook(wb);

    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();

    // Additive: customer yang cocok (Customer Group + Customer Name)
    // diperbarui; customer baru ditambahkan. Customer lama yang tidak ada
    // di file terbaru tetap ada.
    await chunkedUpsert(
      supabase,
      "customers",
      customers.map((c) => ({ ...c, updated_at: now })),
      "customer_group,customer_name"
    );

    const named = customers.filter((c) => c.customer_name).length;
    await supabase.from("app_meta").upsert({
      key: "customers",
      value: { filename: file.name, row_count: named },
      updated_at: now
    });

    return NextResponse.json({ ok: true, rowCount: named });
  } catch (err) {
    const message = err instanceof ParseError ? err.message : (err as Error).message || "Gagal memproses file.";
    const status = err instanceof ParseError ? 422 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
