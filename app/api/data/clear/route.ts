import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { adminPinConfigured, pinDelay, pinOk, PIN_NOT_SET } from "@/lib/adminPin";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Data yang boleh dihapus lewat tombol "Hapus data" di modal Upload. */
type ClearTarget = "uio_units" | "price_contract" | "price_non_contract" | "parts";

const LABEL: Record<ClearTarget, string> = {
  uio_units: "Data UIO",
  price_contract: "Data Harga Kontrak",
  price_non_contract: "Data Harga Non Kontrak",
  parts: "Master Part"
};

/**
 * Menghapus SELURUH isi satu jenis data. Dilindungi PIN admin (env ADMIN_PIN di Vercel),
 * karena website belum punya login. Tidak bisa dibatalkan — upload ulang file untuk mengembalikan.
 */
export async function POST(request: Request) {
  try {
    const body = ((await request.json().catch(() => ({}))) || {}) as { target?: ClearTarget; pin?: unknown };
    if (!adminPinConfigured()) return NextResponse.json({ error: PIN_NOT_SET }, { status: 503 });
    if (!pinOk(body.pin)) {
      await pinDelay();
      return NextResponse.json({ error: "PIN salah." }, { status: 401 });
    }
    const target = body.target;
    if (!target || !(target in LABEL)) {
      return NextResponse.json({ error: "Jenis data tidak dikenal." }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    let deleted = 0;

    if (target === "uio_units") {
      const r = await admin.from("uio_units").delete({ count: "exact" }).gte("id", 0);
      if (r.error) throw r.error;
      deleted = r.count ?? 0;
      await admin.from("app_meta").delete().eq("key", "uio_units");
    } else if (target === "parts") {
      const r = await admin.from("parts").delete({ count: "exact" }).gte("id", 0);
      if (r.error) throw r.error;
      deleted = r.count ?? 0;
      await admin.from("app_meta").delete().eq("key", "kalkulator");
      await admin.rpc("ms_refresh_actual_qty", { p_year: null });
    } else {
      const q = admin.from("price_list").delete({ count: "exact" });
      const r = target === "price_contract" ? await q.eq("price_type", "contract") : await q.neq("price_type", "contract");
      if (r.error) throw r.error;
      deleted = r.count ?? 0;
      await admin.from("app_meta").delete().eq("key", target);
      const left = await admin.from("price_list").select("id", { count: "exact", head: true });
      if (!left.error && (left.count ?? 0) === 0) await admin.from("app_meta").delete().eq("key", "price_list");
    }

    return NextResponse.json({ ok: true, target, label: LABEL[target], deleted });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Gagal menghapus data." }, { status: 500 });
  }
}
