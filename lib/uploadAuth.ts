import "server-only";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { adminPinConfigured, pinDelay, pinOk, PIN_NOT_SET } from "@/lib/adminPin";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * Siapa yang meng-upload. Dikirim browser di setiap request upload (field `auth`) dan dicek DI SERVER:
 *   - admin  → PIN admin (env ADMIN_PIN). Boleh semua: tambah, perbarui, ganti semua, harga, Master Part.
 *   - cabang → kode cabang + kode akses cabang (hash di tabel branch_access). Hanya boleh MENAMBAH unit baru
 *              Data UIO untuk cabangnya sendiri — tidak bisa mengubah / menghapus data yang sudah ada.
 */
export type UploadWho = { role: "admin" } | { role: "branch"; branch: string };
type AuthBody = { role?: unknown; pin?: unknown; branch?: unknown; code?: unknown } | null | undefined;
type AuthResult = { ok: true; who: UploadWho } | { ok: false; error: string; status: number };

export const normBranch = (v: unknown) => String(v ?? "").trim().toUpperCase();

export function hashCode(code: string, salt: string): string {
  return scryptSync(code.trim().toUpperCase(), salt, 32).toString("hex");
}

/** Kode akses baru: 8 karakter, tanpa huruf/angka yang mirip (O/0, I/1/L). */
export function newBranchCode(): { code: string; salt: string; hash: string } {
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const b = randomBytes(8);
  const code = Array.from(b, (x) => A[x % A.length]).join("");
  const salt = randomBytes(16).toString("hex");
  return { code, salt, hash: hashCode(code, salt) };
}

const MIGRATION_HINT = "Tabel branch_access belum ada — jalankan supabase/migration_v28_branch_access.sql di Supabase.";

export async function branchCodeOk(branch: string, code: string): Promise<boolean | "no-table"> {
  if (!branch || !code) return false;
  const { data, error } = await getSupabaseAdmin().from("branch_access").select("code_hash, salt").eq("branch", branch).maybeSingle();
  if (error) return /branch_access/i.test(error.message) ? "no-table" : false;
  if (!data) return false;
  const a = Buffer.from(hashCode(code, data.salt), "hex");
  const b = Buffer.from(String(data.code_hash), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Cek identitas pengupload. `allowBranch` = jenis upload ini boleh dilakukan cabang (hanya Data UIO). */
export async function authUpload(auth: AuthBody, allowBranch: boolean): Promise<AuthResult> {
  const role = auth?.role === "branch" ? "branch" : "admin";
  if (role === "admin") {
    if (!adminPinConfigured()) return { ok: false, error: PIN_NOT_SET, status: 403 };
    if (!pinOk(auth?.pin)) {
      await pinDelay();
      return { ok: false, error: "PIN admin salah. Tidak ada data yang diubah.", status: 401 };
    }
    return { ok: true, who: { role: "admin" } };
  }
  if (!allowBranch) return { ok: false, error: "Data ini hanya bisa di-upload admin (PIN admin).", status: 403 };
  const branch = normBranch(auth?.branch);
  const ok = await branchCodeOk(branch, String(auth?.code ?? ""));
  if (ok === "no-table") return { ok: false, error: MIGRATION_HINT, status: 503 };
  if (!ok) {
    await pinDelay();
    return { ok: false, error: "Kode akses cabang salah. Tidak ada data yang diubah.", status: 401 };
  }
  return { ok: true, who: { role: "branch", branch } };
}

/** Catat satu upload (gagal mencatat tidak menggagalkan upload, mis. tabel belum ada). */
export async function logUpload(entry: {
  who: UploadWho;
  kind: string;
  mode?: string | null;
  filename?: string | null;
  rows_sent?: number | null;
  rows_saved?: number | null;
  rows_rejected?: number | null;
  note?: string | null;
}) {
  try {
    await getSupabaseAdmin()
      .from("upload_log")
      .insert({
        role: entry.who.role === "branch" ? "cabang" : "admin",
        branch: entry.who.role === "branch" ? entry.who.branch : null,
        kind: entry.kind,
        mode: entry.mode ?? null,
        filename: entry.filename ?? null,
        rows_sent: entry.rows_sent ?? null,
        rows_saved: entry.rows_saved ?? null,
        rows_rejected: entry.rows_rejected ?? null,
        note: entry.note ?? null
      });
  } catch {
    /* tabel upload_log belum ada → abaikan */
  }
}
