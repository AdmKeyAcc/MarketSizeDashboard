import "server-only";
import { timingSafeEqual } from "node:crypto";

/** PIN admin (env ADMIN_PIN di Vercel) — dipakai tombol Hapus data & Sinkron ulang semua tahun. */
export const adminPinConfigured = () => (process.env.ADMIN_PIN || "").length > 0;

export function pinOk(given: unknown): boolean {
  const expected = process.env.ADMIN_PIN || "";
  const g = Buffer.from(String(given ?? ""));
  const e = Buffer.from(expected);
  return expected.length > 0 && g.length === e.length && timingSafeEqual(g, e);
}

/** Jeda kecil setelah PIN salah supaya PIN tidak bisa ditebak cepat-cepat. */
export const pinDelay = () => new Promise((r) => setTimeout(r, 1200));

export const PIN_NOT_SET =
  "PIN admin belum diatur. Tambahkan ADMIN_PIN di Vercel → Settings → Environment Variables, lalu redeploy.";
