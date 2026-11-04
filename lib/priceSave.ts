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
    `${r.part_number}|${r.customer_group ?? ""}|${type === "contract" ? (r.price_type === "scpl" ? "scpl" : "contract") : "non_contract"}`;

  // Kunci yang sudah ada (untuk ringkasan diperbarui / baru).
  const existing = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sameType(supabase.from("price_list").select("part_number, customer_group, price_type")).order("id").range(from, from + 999);
    if (error) throw new Error("Gagal membaca Data Harga: " + error.message);
    (data || []).forEach((r: { part_number: string; customer_group: string | null; price_type: string | null }) => existing.add(keyOf(r)));
    if (!data || data.length < 1000) break;
  }
  let updated = 0;
  rows.forEach((r) => {
    if (existing.has(keyOf(r))) updated++;
  });

  try {
    // Kunci baru (migration v24): Part Number + Customer Group + Price Type.
    await chunkedUpsert(supabase, "price_list", rows, "part_number,customer_group,price_type");
  } catch (err) {
    // Migration v24 belum dijalankan → kunci lama (Part Number + Customer Group).
    if (!/unique or exclusion constraint|ON CONFLICT/i.test((err as Error).message || "")) throw err;
    await chunkedUpsert(supabase, "price_list", rows, "part_number,customer_group");
  }

  let removed = 0;
  if (mode === "replace") {
    const del = await sameType(supabase.from("price_list").delete({ count: "exact" })).lt("uploaded_at", now);
    if (del.error) throw new Error("Gagal menghapus harga lama: " + del.error.message);
    removed = del.count ?? 0;
  }
  return { updated, added: rows.length - updated, removed };
}
