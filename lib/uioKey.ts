/** Kunci satu unit fisik Data UIO: PRODUCT::MODEL::SERIAL NUMBER (huruf besar).
 *
 * Aturan dobel Data UIO (disepakati 17 Nov 2026, dari analisa Populasi):
 *   - Dobel = Product + Model + Serial Number sama (mis. satu unit ditagih beberapa kali / termin / invoice ulang).
 *   - Serial Number sama tapi Model berbeda = unit berbeda.
 *   - Engine Number TIDAK dipakai untuk menentukan dobel (isinya sering kode model / kode sistem) — hanya info.
 *   - Baris tanpa Serial Number tidak pernah dianggap dobel (bisa beberapa unit dalam satu invoice).
 * Serial kosong / placeholder ("-", "N/A", …) / kurang dari 3 karakter → null (tidak bisa dicocokkan). */
const PLACEHOLDER_SERIALS = new Set(["-", "", "N/A", "NA", "TIDAK ADA", "NAN", "NONE", "#N/A"]);

export function uioSerialKey(
  product: string | null | undefined,
  serial: string | null | undefined,
  model: string | null | undefined
): string | null {
  const t = String(serial ?? "").trim().toUpperCase();
  if (t.length < 3 || PLACEHOLDER_SERIALS.has(t)) return null;
  return `${String(product ?? "").trim().toUpperCase()}::${String(model ?? "").trim().toUpperCase()}::${t}`;
}
