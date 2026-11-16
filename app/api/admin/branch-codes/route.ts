import { NextResponse } from "next/server";
import { adminPinConfigured, pinDelay, pinOk, PIN_NOT_SET } from "@/lib/adminPin";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { newBranchCode, normBranch } from "@/lib/uploadAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Kelola kode akses cabang (khusus admin, PIN admin dicek di server).
 *   list   → cabang yang sudah punya kode (tanpa kodenya — kode tidak disimpan, hanya hash)
 *   set    → buat kode BARU untuk satu cabang; kode ditampilkan SEKALI ke admin untuk diberikan ke orang cabang.
 *            Kode lama otomatis tidak berlaku.
 *   remove → cabut akses cabang
 */
export async function POST(request: Request) {
  const body = ((await request.json().catch(() => ({}))) || {}) as { pin?: unknown; action?: string; branch?: unknown };
  if (!adminPinConfigured()) return NextResponse.json({ error: PIN_NOT_SET }, { status: 503 });
  if (!pinOk(body.pin)) {
    await pinDelay();
    return NextResponse.json({ error: "PIN admin salah." }, { status: 401 });
  }
  const sb = getSupabaseAdmin();
  const noTable = (m: string) => /branch_access/i.test(m);
  try {
    if (body.action === "list") {
      const { data, error } = await sb.from("branch_access").select("branch, updated_at").order("branch");
      if (error) throw error;
      return NextResponse.json({ ok: true, branches: data ?? [] });
    }
    const branch = normBranch(body.branch);
    if (!branch) return NextResponse.json({ error: "Pilih cabang." }, { status: 400 });
    if (body.action === "set") {
      const c = newBranchCode();
      const { error } = await sb
        .from("branch_access")
        .upsert({ branch, code_hash: c.hash, salt: c.salt, updated_at: new Date().toISOString() }, { onConflict: "branch" });
      if (error) throw error;
      return NextResponse.json({ ok: true, branch, code: c.code });
    }
    if (body.action === "remove") {
      const { error } = await sb.from("branch_access").delete().eq("branch", branch);
      if (error) throw error;
      return NextResponse.json({ ok: true, branch });
    }
    return NextResponse.json({ error: "Aksi tidak dikenal." }, { status: 400 });
  } catch (err) {
    const m = (err as Error).message || "Gagal.";
    return NextResponse.json(
      { error: noTable(m) ? "Tabel branch_access belum ada — jalankan supabase/migration_v28_branch_access.sql di Supabase." : m },
      { status: noTable(m) ? 503 : 500 }
    );
  }
}
