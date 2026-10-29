/**
 * Data referensi (kamus & pengaturan) yang dikelola admin langsung di Supabase,
 * bukan lewat upload:
 *   - product_alias : kode/nama product → nama product kanonik (TYT → TOYOTA)
 *   - ka_types      : daftar KA Type + urutannya
 *   - app_settings  : angka default rumus (HM/hari, hari kerja/bulan, bulan/tahun, potongan non kontrak)
 *
 * Nilai di DEFAULT_REFERENCES dipakai kalau tabel belum dibuat / kosong, supaya
 * dashboard tetap jalan sebelum migration dijalankan.
 *
 * Modul ini sengaja tidak meng-import file lain (menghindari import melingkar).
 */

export type AppSettings = {
  /** HM/hari kalau Data UIO maupun Master Part tidak punya angkanya. */
  default_hm_day: number;
  /** Hari kerja per bulan kalau kolom Day/Month di Data UIO kosong. */
  default_workdays_month: number;
  /** Bulan operasi per tahun kalau kolom Month/Year di Data UIO kosong. */
  default_months_year: number;
  /** Potongan harga non kontrak (0,5 = harga nett 50% dari harga tertera). */
  non_contract_discount: number;
  /** Hari kerja kalender Januari–Desember (app_settings workdays_01..workdays_12). Dipakai untuk
   * menyebar jam operasi setahun ke tiap bulan: bulan dengan hari kerja lebih sedikit (mis. Februari,
   * bulan Lebaran) mendapat jam lebih sedikit. Totalnya tetap sama. */
  workdays_by_month: number[];
};

export type References = {
  productAlias: Record<string, string>;
  /** KA Type berurutan (urutan = urutan tampil di filter & tabel). */
  kaTypes: string[];
  settings: AppSettings;
};

export const DEFAULT_SETTINGS: AppSettings = {
  default_hm_day: 8,
  default_workdays_month: 22,
  default_months_year: 12,
  non_contract_discount: 0.5,
  workdays_by_month: [22, 20, 22, 22, 21, 22, 23, 21, 22, 22, 21, 22]
};

export const DEFAULT_REFERENCES: References = {
  productAlias: {
    TYT: "TOYOTA",
    PER: "PERKINS",
    MFT: "MF",
    KBT: "KUBOTA",
    BTF: "BT",
    GDD: "GD",
    CNC: "CANYCOM",
    FGW: "FG WILSON",
    IRN: "IR",
    LBT: "LINK-BELT",
    "MASSEY FERGUSON": "MF",
    "GARDNER DENVER": "GD"
  },
  kaTypes: ["KA NASIONAL", "KA BRANCH PLATINUM", "KA BRANCH GOLD", "NKA", "DEALER", "SHN"],
  settings: DEFAULT_SETTINGS
};

let current: References = DEFAULT_REFERENCES;
let kaIndex = new Map<string, number>(current.kaTypes.map((k, i) => [k, i]));
const listeners: (() => void)[] = [];

/** Referensi yang sedang aktif. */
export function refs(): References {
  return current;
}

/** Pasang referensi hasil fetch dari Supabase. Aman dipanggil berulang (tidak berbuat apa-apa kalau objeknya sama). */
export function applyReferences(r: References | null | undefined): void {
  if (!r || r === current) return;
  current = r;
  kaIndex = new Map(r.kaTypes.map((k, i) => [k.trim().toUpperCase(), i]));
  listeners.forEach((fn) => fn());
}

/** Dipakai modul lain untuk mengosongkan cache saat referensi berganti. */
export function onReferencesChange(fn: () => void): void {
  listeners.push(fn);
}

/** Urutan KA Type (yang tidak dikenal di urutan paling akhir). */
export function kaRank(t: string | null | undefined): number {
  const i = kaIndex.get(String(t || "").trim().toUpperCase());
  return i === undefined ? 999 : i;
}

export function isKnownKaType(t: string | null | undefined): boolean {
  return kaIndex.has(String(t || "").trim().toUpperCase());
}

/** Angka positif atau fallback. */
function pos(v: unknown, fallback: number, max = Infinity): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= max ? n : fallback;
}

/** Bentuk References dari baris-baris tabel Supabase (tabel kosong/hilang → default). */
export function buildReferences(
  aliasRows: { alias: string | null; product: string | null }[] | null,
  kaRows: { name: string | null; sort_order: number | null }[] | null,
  settingRows: { key: string; value: number | string | null }[] | null
): References {
  let productAlias = DEFAULT_REFERENCES.productAlias;
  if (aliasRows && aliasRows.length > 0) {
    productAlias = {};
    aliasRows.forEach((r) => {
      const a = String(r.alias || "").trim().toUpperCase();
      const p = String(r.product || "").trim().toUpperCase();
      if (a && p) productAlias[a] = p;
    });
  }

  let kaTypes = DEFAULT_REFERENCES.kaTypes;
  if (kaRows && kaRows.length > 0) {
    kaTypes = kaRows
      .filter((r) => String(r.name || "").trim())
      .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999))
      .map((r) => String(r.name).trim().toUpperCase());
  }

  const raw: Record<string, unknown> = {};
  (settingRows || []).forEach((r) => {
    raw[r.key] = r.value;
  });
  const settings: AppSettings = {
    default_hm_day: pos(raw.default_hm_day, DEFAULT_SETTINGS.default_hm_day, 24),
    default_workdays_month: pos(raw.default_workdays_month, DEFAULT_SETTINGS.default_workdays_month, 31),
    default_months_year: pos(raw.default_months_year, DEFAULT_SETTINGS.default_months_year, 12),
    non_contract_discount: (() => {
      const n = Number(raw.non_contract_discount);
      return Number.isFinite(n) && n >= 0 && n < 1 ? n : DEFAULT_SETTINGS.non_contract_discount;
    })(),
    workdays_by_month: DEFAULT_SETTINGS.workdays_by_month.map((d, i) =>
      pos(raw[`workdays_${String(i + 1).padStart(2, "0")}`], d, 31)
    )
  };

  return { productAlias, kaTypes, settings };
}
