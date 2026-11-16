import { NextResponse } from "next/server";
import { authUpload } from "@/lib/uploadAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Masuk ke modal Upload: cek PIN admin atau kode akses cabang (tidak mengubah data apa pun). */
export async function POST(request: Request) {
  const body = ((await request.json().catch(() => ({}))) || {}) as { auth?: Record<string, unknown> };
  const r = await authUpload(body.auth, true);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, role: r.who.role, branch: r.who.role === "branch" ? r.who.branch : null });
}
