import { replacePinError } from "@/lib/adminPin";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { fetchReferences } from "@/lib/fetchDashboardDataShared";
import { chunkedUpsert } from "@/lib/supabase/bulk";

export const runtime = "nodejs";
export const maxDuration = 60;

type Kind = "contract" | "non_contract";
type Body = {
  action?: "start" | "rows" | "finish";
  kind?: Kind;
  mode?: "merge" | "replace";
  pin?: unknown;
  since?: string;
  filename?: string;
  rows?: Record<string, unknown>[];
  /** Ringkasan hasil baca file (dikirim saat finish, untuk app_meta). */
  rowCount?: number;
  discount?: number;
};

/**
 * Upload Data Harga bertahap: file dibaca di browser lalu dikirim per potongan, supaya file besar
 * (puluhan ribu baris) tidak melewati batas waktu 60 detik / ukuran request Vercel.
 *   start  → cek PIN (Ganti semua), kembalikan cap waktu + discount Non Kontrak + jumlah harga lama
 *   rows   → simpan satu potongan (upsert)
 *   finish → Ganti semua: hapus harga jenis ini yang lebih lama dari cap waktu; simpan info upload
 * Data baru disimpan dulu baru data lama dihapus — kalau gagal di tengah, data lama tidak hilang.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const kind: Kind = body.kind === "non_contract" ? "non_contract" : "contract";
    const mode = body.mode === "replace" ? "replace" : "merge";
    const supabase = getSupabaseAdmin();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sameType = (q: any): any =>
      kind === "contract" ? q.in("price_type", ["contract", "scpl"]) : q.or("price_type.is.null,price_type.not.in.(contract,scpl)");
    const countType = async () => {
      const { count, error } = await sameType(supabase.from("price_list").select("id", { count: "exact", head: true }));
      if (error) throw new Error("Gagal membaca Data Harga: " + error.message);
      return count ?? 0;
    };

    if (body.action === "start" || body.action === "finish") {
      const pinErr = await replacePinError(mode, body.pin);
      if (pinErr) return NextResponse.json({ error: pinErr.error }, { status: pinErr.status });
    }

    if (body.action === "start") {
      const { settings } = await fetchReferences(supabase);
      return NextResponse.json({ ok: true, since: new Date().toISOString(), discount: settings.non_contract_discount, before: await countType() });
    }

    const since = body.since && !Number.isNaN(Date.parse(body.since)) ? body.since : null;
    if (!since) return NextResponse.json({ error: "Upload belum dimulai (cap waktu kosong)." }, { status: 400 });

    if (body.action === "rows") {
      const rows = (body.rows || []).map((r) => ({
        part_number: String(r.part_number ?? "").trim(),
        customer_group: String(r.customer_group ?? ""),
        customer_code: String(r.customer_code ?? "").trim().toUpperCase(),
        customer_name: (r.customer_name as string | null) ?? null,
        customer_type: (r.customer_type as string | null) ?? null,
        price: Number(r.price) || 0,
        list_price: r.list_price === null || r.list_price === undefined ? null : Number(r.list_price),
        price_type: kind === "contract" ? (r.price_type === "scpl" ? "scpl" : "contract") : "non_contract",
        source_filename: body.filename || null,
        uploaded_at: since
      })).filter((r) => r.part_number);
      // Kunci terbaru (migration v25); kalau belum dijalankan, coba kunci versi sebelumnya.
      const keys = ["part_number,customer_code,customer_group,price_type", "part_number,customer_group,price_type", "part_number,customer_group"];
      for (let i = 0; i < keys.length; i++) {
        try {
          await chunkedUpsert(supabase, "price_list", rows, keys[i], 1000);
          break;
        } catch (err) {
          if (i === keys.length - 1 || !/unique or exclusion constraint|ON CONFLICT/i.test((err as Error).message || "")) throw err;
        }
      }
      return NextResponse.json({ ok: true, saved: rows.length });
    }

    if (body.action === "finish") {
      const afterUpsert = await countType();
      let removed = 0;
      if (mode === "replace") {
        const del = await sameType(supabase.from("price_list").delete({ count: "exact" })).lt("uploaded_at", since);
        if (del.error) throw new Error("Gagal menghapus harga lama: " + del.error.message);
        removed = del.count ?? 0;
      }
      const now = new Date().toISOString();
      const value: Record<string, unknown> = { filename: body.filename, row_count: body.rowCount ?? 0, mode, type: kind };
      if (kind === "non_contract" && typeof body.discount === "number") value.discount = body.discount;
      await supabase.from("app_meta").upsert({ key: kind === "contract" ? "price_contract" : "price_non_contract", value, updated_at: now });
      await supabase.from("app_meta").upsert({ key: "price_list", value, updated_at: now });
      return NextResponse.json({ ok: true, removed, afterUpsert, totalInDb: await countType() });
    }

    return NextResponse.json({ error: "Aksi tidak dikenal." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Gagal memproses Data Harga." }, { status: 500 });
  }
}
