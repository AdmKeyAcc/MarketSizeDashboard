import { NextResponse } from "next/server";
import { adminPinConfigured, pinDelay, pinOk, PIN_NOT_SET } from "@/lib/adminPin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cek PIN admin sebelum menjalankan pekerjaan berat dari browser (mis. Sinkron ulang semua tahun). */
export async function POST(request: Request) {
  const body = ((await request.json().catch(() => ({}))) || {}) as { pin?: unknown };
  if (!adminPinConfigured()) return NextResponse.json({ error: PIN_NOT_SET }, { status: 503 });
  if (!pinOk(body.pin)) {
    await pinDelay();
    return NextResponse.json({ error: "PIN salah." }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
