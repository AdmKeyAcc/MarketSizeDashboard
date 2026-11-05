import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkedUpsert } from "@/lib/supabase/bulk";

export type UploadMode = "merge" | "replace";
export const modeOf = (v: unknown): UploadMode => (v === "replace" ? "replace" : "merge");

/**
 * Simpan Data Harga (kontrak / non kontrak) ke price_list.
 *  - merge   : Part Number + Customer Group + Price Type yang sama diperbarui, yang baru ditambahkan, sisanya tetap.
 *  - replace : sama seperti merge, LALU harga jenis ini yang tidak ada di file dihapus.
 * Data baru selalu disimpan dulu baru yang lama dihapus — kalau gagal di tengah, data lama tidak hilang.
 */
export async function savePrices(
  supabase: SupabaseClient,
  type: "contract" | "non_contract",
  rows: Record<string, unknown>[],
  mode: UploadMode,
  now: string
): Promise<{ updated: number; added: number; removed: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sameType = (q: any): any =>
    type === "contract" ? q.in("price_type", ["contract", "scpl"]) : q.or("price_type.is.null,price_type.not.in.(contract,scpl)");
  const keyOf = (r: Record<string, unknown>) =>
    `${r.part_number}|${String(r.customer_code ?? "").trim().toUpperCase()}|${r.customer_group ?? ""}|${type === "contract" ? (r.price_type === "scpl" ? "scpl" : "contract") : "non_contract"}`;

  // Kunci yang sudah ada (untuk ringkasan diperbarui / baru).
  const existing = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sameType(supabase.from("price_list").select("part_number, customer_code, customer_group, price_type")).order("id").range(from, from + 999);
    if (error) throw new Error("Gagal membaca Data Harga: " + error.message);
    (data || []).forEach((r: Record<string, unknown>) => existing.add(keyOf(r)));
    if (!data || data.length < 1000) break;
  }
  let updated = 0;
  rows.forEach((r) => {
    if (existing.has(keyOf(r))) updated++;
  });

  // Kunci terbaru (migration v25): Part Number + Customer Code + Customer Group + Price Type; kalau migration belum
  // dijalankan, coba kunci versi sebelumnya.
  const keys = ["part_number,customer_code,customer_group,price_type", "part_number,customer_group,price_type", "part_number,customer_group"];
  const clean = rows.map((r) => ({ ...r, customer_code: String(r.customer_code ?? "").trim().toUpperCase() }));
  for (let i = 0; i < keys.length; i++) {
    try {
      await chunkedUpsert(supabase, "price_list", clean, keys[i], 1000);
      break;
    } catch (err) {
      if (i === keys.length - 1 || !/unique or exclusion constraint|ON CONFLICT/i.test((err as Error).message || "")) throw err;
    }
  }

  let removed = 0;
  if (mode === "replace") {
    const del = await sameType(supabase.from("price_list").delete({ count: "exact" })).lt("uploaded_at", now);
    if (del.error) throw new Error("Gagal menghapus harga lama: " + del.error.message);
    removed = del.count ?? 0;
  }
  return { updated, added: rows.length - updated, removed };
}
