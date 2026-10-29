/** Kunci satu unit fisik Data UIO: PRODUCT::SERIAL NUMBER (huruf besar).
 * Serial kosong / placeholder ("-", "N/A", …) / kurang dari 3 karakter → null (tidak bisa dicocokkan). */
const PLACEHOLDER_SERIALS = new Set(["-", "", "N/A", "NA", "TIDAK ADA", "NAN", "NONE", "#N/A"]);

export function uioSerialKey(product: string | null | undefined, serial: string | null | undefined): string | null {
  const t = String(serial ?? "").trim().toUpperCase();
  if (t.length < 3 || PLACEHOLDER_SERIALS.has(t)) return null;
  return `${String(product ?? "").trim().toUpperCase()}::${t}`;
}
