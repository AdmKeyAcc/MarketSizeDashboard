import { NextResponse } from "next/server";
import * as XLSX from "@e965/xlsx";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { parseActualSalesWorkbook } from "@/lib/parse/actualSales";
import { ParseError } from "@/lib/parse/xlsxHelpers";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Tidak ada file yang dikirim." }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "File terlalu besar (maks 10 MB)." }, { status: 413 });
    }

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const { rows, skipped } = parseActualSalesWorkbook(wb);

    const supabase = getSupabaseAdmin();
    const up = await supabase
      .from("actual_sales")
      .upsert(
        rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })),
        { onConflict: "year,month,product" }
      );
    if (up.error) throw up.error;

    await supabase.from("app_meta").upsert({
      key: "actual_sales",
      value: { filename: file.name, row_count: rows.length },
      updated_at: new Date().toISOString()
    });

    return NextResponse.json({ ok: true, rowCount: rows.length, skipped });
  } catch (err) {
    const message = err instanceof ParseError ? err.message : (err as Error).message || "Gagal memproses file.";
    const status = err instanceof ParseError ? 422 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
