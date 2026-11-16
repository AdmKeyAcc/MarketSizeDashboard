/** Identitas pengupload di browser (dikirim ke server di setiap request upload; dicek di server — lib/uploadAuth). */
export type UploadAuth = { role: "admin"; pin: string } | { role: "branch"; branch: string; code: string };

export const isAdmin = (a: UploadAuth | null): a is { role: "admin"; pin: string } => a?.role === "admin";

/** Cek PIN admin / kode akses cabang ke server. */
export async function signInUpload(auth: UploadAuth): Promise<{ ok: true; role: "admin" | "branch"; branch: string | null } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/upload/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ auth }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: j.error || `Gagal (${res.status}).` };
    return { ok: true, role: j.role, branch: j.branch ?? null };
  } catch (err) {
    return { ok: false, error: (err as Error).message || "Gagal terhubung ke server." };
  }
}

/** Kelola kode akses cabang (admin). */
export async function branchCodes(pin: string, action: "list" | "set" | "remove", branch?: string): Promise<any> {
  const res = await fetch("/api/admin/branch-codes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin, action, branch }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Gagal (${res.status}).`);
  return j;
}
