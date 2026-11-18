/**
 * Pencocokan ejaan untuk pengecekan upload (typo).
 *   - loose: huruf besar, tanpa spasi / tanda baca → "pt. abc" dan "PT ABC" dianggap sama.
 *   - saran: nilai terdaftar yang ejaannya paling mirip (jarak edit kecil), untuk pesan "mungkin maksudnya …".
 */

/** Huruf Kirilik/Yunani yang bentuknya sama dengan huruf Latin (sering terbawa dari copy-paste) → huruf Latin. */
const HOMO: Record<string, string> = { А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", У: "Y", І: "I", Ј: "J", Ѕ: "S", Α: "A", Β: "B", Ε: "E", Ζ: "Z", Η: "H", Ι: "I", Κ: "K", Μ: "M", Ν: "N", Ο: "O", Ρ: "P", Τ: "T", Υ: "Y", Χ: "X" };
/** Huruf besar + huruf Latin biasa (aksen & huruf kembar Kirilik dihilangkan). */
export const plain = (v: unknown): string =>
  String(v ?? "")
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u0370-\u04ff]/g, (c) => HOMO[c] ?? c);

/** Kunci longgar: huruf besar, hanya huruf & angka. */
export const loose = (v: unknown): string => plain(v).replace(/[^A-Z0-9]/g, "");

/** Jarak edit (Levenshtein) dengan batas: berhenti lebih awal bila pasti > max. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** Batas typo menurut panjang kata: pendek 1 huruf, sedang 2, panjang 3. */
const maxDist = (len: number) => (len <= 3 ? 0 : len <= 5 ? 1 : len <= 12 ? 2 : 3);

export type Match = {
  /** Ejaan terdaftar yang sama (abaikan huruf besar/kecil, spasi, tanda baca); null = tidak ada. */
  exact: string | null;
  /** Ejaan terdaftar yang paling mirip (kalau tidak ada yang sama). */
  suggest: string | null;
};

/** Nama ≥ 30 huruf kemungkinan terpotong oleh batas panjang kolom di sistem sumber (mis. 35 karakter). */
export const TRUNC_MIN = 30;

/**
 * Pembuat pencocok untuk satu daftar nilai terdaftar. Hasil per nilai di-cache.
 * `opts.truncated`: nama yang terpotong dianggap sama — kalau salah satu ejaan panjangnya ≥ 30 huruf dan kuncinya
 * adalah awal dari kunci ejaan lain ("…PANDU ENGINEERI" = "…PANDU ENGINEERING", "NIK : 620205231066000" =
 * "NIK : 6202052310660001"), hanya bila pasangannya satu.
 */
export function makeMatcher(
  values: string[],
  keyOf: (v: unknown) => string = loose,
  opts: { truncated?: boolean; /** Saran hanya dipakai kalau lolos cek ini (mis. plausibleCompanyTypo). */ accept?: (input: string, candidate: string) => boolean } = {}
): (v: unknown) => Match {
  const byLoose = new Map<string, string>();
  values.forEach((x) => {
    const s = String(x ?? "").trim();
    const k = keyOf(s);
    if (k && !byLoose.has(k)) byLoose.set(k, s);
  });
  const keys = Array.from(byLoose.keys());
  const longKeys = keys.filter((k) => byLoose.get(k)!.length >= TRUNC_MIN);
  const truncMatch = (k: string, rawLen: number): string | null => {
    const hits = new Set<string>();
    if (rawLen >= TRUNC_MIN) for (const c of keys) if (c.length > k.length && c.startsWith(k)) hits.add(c);
    for (const c of longKeys) if (c.length < k.length && k.startsWith(c)) hits.add(c);
    return hits.size === 1 ? Array.from(hits)[0] : null;
  };
  const cache = new Map<string, Match>();
  return (v) => {
    const k = keyOf(v);
    if (!k) return { exact: null, suggest: null };
    const hit = cache.get(k);
    if (hit) return hit;
    let res: Match;
    const ex = byLoose.get(k);
    const tk = ex === undefined && opts.truncated ? truncMatch(k, String(v ?? "").trim().length) : null;
    if (ex !== undefined) res = { exact: ex, suggest: null };
    else if (tk) res = { exact: byLoose.get(tk)!, suggest: null };
    else {
      const lim = maxDist(k.length);
      let best: string | null = null, bestD = lim + 1, ties = 0;
      if (lim > 0)
        for (const c of keys) {
          const d = editDistance(k, c, Math.min(lim, bestD));
          if (d < bestD) {
            bestD = d;
            best = c;
            ties = 1;
          } else if (d === bestD && d <= lim) ties++;
        }
      // Saran hanya kalau satu kandidat paling mirip (tidak ambigu).
      let sug = best && bestD <= lim && ties === 1 ? byLoose.get(best)! : null;
      if (sug && opts.accept && !opts.accept(String(v ?? ""), sug)) sug = null;
      res = { exact: null, suggest: sug };
    }
    cache.set(k, res);
    return res;
  };
}

/** Kata badan usaha yang diabaikan saat mencocokkan nama perusahaan. */
const ENTITY_WORDS = new Set(["PT", "CV", "TBK", "PERSERO", "UD", "PD", "FA", "PERUM", "PERSEROAN", "TERBATAS", "GROUP"]);

/**
 * Kunci nama perusahaan: huruf besar, tanda baca dibuang, kata badan usaha (PT, CV, Tbk, Persero, …) diabaikan.
 * "PT. KAHATEX", "KAHATEX, PT" dan "Kahatex PT" → "KAHATEX"; "&" = "AND"; kata "GROUP" diabaikan;
 * huruf Kirilik yang mirip huruf Latin (copy-paste) disamakan.
 */
export function companyKey(v: unknown): string {
  const words = plain(v)
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w && !ENTITY_WORDS.has(w));
  return words.join("");
}

/** Kata-kata nama perusahaan (tanpa kata badan usaha), mis. "PT. SUMBER REZEKI" → ["SUMBER", "REZEKI"]. */
export function companyWords(v: unknown): string[] {
  return plain(v)
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w && !ENTITY_WORDS.has(w));
}

/**
 * Apakah "mungkin maksudnya …" masuk akal untuk nama perusahaan / group? Mencegah saran palsu yang hanya
 * mirip karena kata umum (mis. "DENSO INDONESIA" → "DNP INDONESIA", "KINO INDONESIA" → "KAO INDONESIA").
 * Diterima bila:
 *   - sama kalau spasi diabaikan, atau beda spasi + 1 huruf ("MUSIMAS" ~ "MUSIM MAS");
 *   - jumlah kata sama dan paling banyak 2 kata berbeda, masing-masing salah ketik kecil
 *     (≤ 1 huruf untuk kata ≤ 7 huruf, ≤ 2 huruf untuk kata lebih panjang): "REZEKI" ~ "REJEKI", "PLANTATIONS" ~ "PLANTATION";
 *   - salah satunya hanya punya tambahan kata pendek (≤ 3 huruf, mis. singkatan / sisa nama terpotong): "FR FIRST RESOURCES" ~ "FIRST RESOURCES".
 */
export function plausibleCompanyTypo(a: string, b: string): boolean {
  const wa = companyWords(a), wb = companyWords(b);
  if (wa.length === 0 || wb.length === 0) return false;
  const ja = wa.join(""), jb = wb.join("");
  if (ja === jb) return true;
  // Beda spasi + 1 huruf ("MUSIMAS" ~ "MUSIM MAS")
  if (wa.length !== wb.length && Math.min(ja.length, jb.length) >= 6 && editDistance(ja, jb, 1) <= 1) return true;
  const small = (x: string, y: string) => {
    const lim = Math.max(x.length, y.length) <= 7 ? 1 : 2;
    return editDistance(x, y, lim) <= lim;
  };
  if (wa.length === wb.length) {
    let diff = 0;
    for (let i = 0; i < wa.length; i++) {
      if (wa[i] === wb[i]) continue;
      if (!small(wa[i], wb[i])) return false;
      diff++;
    }
    return diff >= 1 && diff <= 2;
  }
  const [lo, hi] = wa.length < wb.length ? [wa, wb] : [wb, wa];
  const extra = hi.filter((w) => !lo.includes(w));
  return extra.length === hi.length - lo.length && extra.every((w) => w.length <= 3) && lo.every((w) => hi.includes(w));
}

/** Dua nama perusahaan dianggap sama: kunci perusahaan sama, atau salah satunya nama terpotong (≥ 30 huruf) dari yang lain. */
export function sameCompany(a: unknown, b: unknown): boolean {
  const ka = companyKey(a), kb = companyKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const [sRaw, sk, lk] = ka.length <= kb.length ? [String(a ?? ""), ka, kb] : [String(b ?? ""), kb, ka];
  return sRaw.trim().length >= TRUNC_MIN && lk.startsWith(sk);
}
