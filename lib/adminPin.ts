import "server-only";
import { timingSafeEqual } from "node:crypto";

/** PIN admin (env ADMIN_PIN di Vercel) — wajib untuk upload mode "Ganti semua". */
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

/** Upload mode "Ganti semua" wajib PIN admin. Mengembalikan pesan error (dan status) kalau ditolak, null kalau boleh. */
export async function replacePinError(mode: unknown, pin: unknown): Promise<{ error: string; status: number } | null> {
  if (mode !== "replace") return null;
  if (!adminPinConfigured()) return { error: PIN_NOT_SET, status: 403 };
  if (!pinOk(pin)) {
    await pinDelay();
    return { error: "PIN admin salah — mode Ganti semua butuh PIN admin. Tidak ada data yang diubah.", status: 401 };
  }
  return null;
}
