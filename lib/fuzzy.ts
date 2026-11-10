/**
 * Pencocokan ejaan untuk pengecekan upload (typo).
 *   - loose: huruf besar, tanpa spasi / tanda baca → "pt. abc" dan "PT ABC" dianggap sama.
 *   - saran: nilai terdaftar yang ejaannya paling mirip (jarak edit kecil), untuk pesan "mungkin maksudnya …".
 */

/** Kunci longgar: huruf besar, hanya huruf & angka. */
export const loose = (v: unknown): string => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

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

/** Pembuat pencocok untuk satu daftar nilai terdaftar. Hasil per nilai di-cache. */
export function makeMatcher(values: string[], keyOf: (v: unknown) => string = loose): (v: unknown) => Match {
  const byLoose = new Map<string, string>();
  values.forEach((x) => {
    const s = String(x ?? "").trim();
    const k = keyOf(s);
    if (k && !byLoose.has(k)) byLoose.set(k, s);
  });
  const keys = Array.from(byLoose.keys());
  const cache = new Map<string, Match>();
  return (v) => {
    const k = keyOf(v);
    if (!k) return { exact: null, suggest: null };
    const hit = cache.get(k);
    if (hit) return hit;
    let res: Match;
    const ex = byLoose.get(k);
    if (ex !== undefined) res = { exact: ex, suggest: null };
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
      res = { exact: null, suggest: best && bestD <= lim && ties === 1 ? byLoose.get(best)! : null };
    }
    cache.set(k, res);
    return res;
  };
}

/** Kata badan usaha yang diabaikan saat mencocokkan nama perusahaan. */
const ENTITY_WORDS = new Set(["PT", "CV", "TBK", "PERSERO", "UD", "PD", "FA", "PERUM", "PERSEROAN", "TERBATAS"]);

/**
 * Kunci nama perusahaan: huruf besar, tanda baca dibuang, kata badan usaha (PT, CV, Tbk, Persero, …) diabaikan.
 * "PT. KAHATEX", "KAHATEX, PT" dan "Kahatex PT" → "KAHATEX".
 */
export function companyKey(v: unknown): string {
  const words = String(v ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w && !ENTITY_WORDS.has(w));
  return words.join("");
}
