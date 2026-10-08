/** Aturan edit kolom di tabel Detail part (dipakai UI & API supaya sama). */
export const EDITABLE_FIELDS = ["hm_day", "freq_replacement_hm", "qty_per_unit", "price"] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export const FIELD_LABEL: Record<EditableField, string> = {
  hm_day: "HM/Day",
  freq_replacement_hm: "Frekuensi ganti (HM)",
  qty_per_unit: "Qty per unit",
  price: "Price (Rp)"
};

/** Validasi satu nilai. Mengembalikan angka bersih atau pesan error. */
export function validateEdit(field: string, raw: unknown): { ok: true; value: number } | { ok: false; error: string } {
  if (!(EDITABLE_FIELDS as readonly string[]).includes(field)) return { ok: false, error: `Kolom '${field}' tidak boleh diedit.` };
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isFinite(n)) return { ok: false, error: "Nilai harus berupa angka." };
  if (n < 0) return { ok: false, error: "Nilai tidak boleh negatif." };
  if (field === "hm_day" && (n <= 0 || n > 24)) return { ok: false, error: "HM/Day harus lebih dari 0 dan maksimal 24 jam." };
  if (field === "freq_replacement_hm" && n <= 0) return { ok: false, error: "Frekuensi ganti harus lebih dari 0." };
  if (n > 1e12) return { ok: false, error: "Nilai terlalu besar." };
  return { ok: true, value: n };
}
