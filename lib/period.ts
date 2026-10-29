import { MONTH_ORDER } from "@/lib/types";
import { refs } from "@/lib/references";

/**
 * Periode pembanding Market Size vs Actual dalam satu tahun, sebagai daftar indeks bulan (0 = Januari).
 *   - filter Bulan diisi            → bulan-bulan itu
 *   - tahun berjalan (data YTD)     → Januari s/d bulan terakhir data Actual
 *   - selain itu                    → null (setahun penuh)
 * Satu fungsi ini dipakai KPI, chart, tabel hierarki dan Summary supaya periodenya selalu sama.
 */
export type Period = { months: number[] | null; label: string };

export const ALL_MONTHS = Array.from({ length: 12 }, (_, i) => i);

export function monthIdx(name: string | null | undefined): number {
  return (MONTH_ORDER as readonly string[]).findIndex((m) => m.toLowerCase() === String(name || "").trim().toLowerCase());
}

export function periodOf(
  year: number,
  bulan: string[],
  ytd: { year: number | null; month: string | null },
  /** false = tahun ini tidak punya Actual, jadi tidak perlu dipotong YTD. */
  hasActual = true
): Period {
  if (bulan.length > 0) {
    const months = Array.from(new Set(bulan.map(monthIdx).filter((i) => i >= 0))).sort((a, b) => a - b);
    if (months.length === 12) return { months: null, label: String(year) };
    return { months, label: `${year} · ${months.length} bln` };
  }
  const yi = monthIdx(ytd.month);
  if (hasActual && ytd.year === year && yi >= 0 && yi < 11) {
    return { months: ALL_MONTHS.slice(0, yi + 1), label: `${year} · Jan–${MONTH_ORDER[yi].slice(0, 3)}` };
  }
  return { months: null, label: String(year) };
}

export const monthsCount = (p: Period) => (p.months ? p.months.length : 12);

/** Bobot kalender per bulan (rata-rata = 1): hari kerja bulan itu ÷ rata-rata hari kerja per bulan. */
let cacheKey: number[] | null = null;
let cacheVal: number[] = [];
export function calendarWeights(): number[] {
  const wd = refs().settings.workdays_by_month;
  if (wd !== cacheKey) {
    const avg = wd.reduce((a, b) => a + b, 0) / 12;
    cacheVal = wd.map((d) => (avg > 0 ? d / avg : 1));
    cacheKey = wd;
  }
  return cacheVal;
}

/** Jumlah nilai bulanan untuk periode (null = setahun → pakai `annual`, angka setahun yang sudah dibulatkan). */
export function sumPeriod(monthly: ArrayLike<number> | null | undefined, months: number[] | null, annual: number): number {
  if (!months) return annual;
  if (!monthly) return 0;
  let s = 0;
  for (const m of months) s += monthly[m] || 0;
  return s;
}

/**
 * Rencana perbandingan Market Size vs Actual, dipakai bersama oleh KPI, chart, tabel hierarki dan Summary.
 *   monthsOf(y)       → bulan periode Market Size (null = setahun)
 *   actualMonthsOf(y) → bulan periode Actual (null = total tahun; array hanya kalau filter Bulan dipakai)
 *   actualOkOf(y)     → Actual bisa dibandingkan? (filter Bulan butuh rincian bulanan; Model/Part tidak bisa)
 */
export type ComparePlan = {
  monthsOf: (year: number) => number[] | null;
  actualMonthsOf: (year: number) => number[] | null;
  actualOkOf: (year: number) => boolean;
  labelOf: (year: number) => string;
  /** Alasan Actual tidak bisa dibandingkan (untuk ditampilkan), "" kalau bisa. */
  whyNot: (year: number) => string;
};

export function comparePlan(
  actualRows: { year: number; product?: string | null; amount_by_month?: number[] | null }[],
  filters: { bulan: string[]; product: string[]; modelUnit: string[]; partNumber: string[]; partName: string[] },
  ytd: { year: number | null; month: string | null }
): ComparePlan {
  const actualYears = new Set<number>();
  const monthlyYears = new Set<number>();
  let hasProduct = false;
  actualRows.forEach((r) => {
    actualYears.add(r.year);
    if (Array.isArray(r.amount_by_month) && r.amount_by_month.length === 12) monthlyYears.add(r.year);
    if (r.product) hasProduct = true;
  });
  const partLevel = filters.modelUnit.length > 0 || filters.partNumber.length > 0 || filters.partName.length > 0;
  const productBlocked = filters.product.length > 0 && !hasProduct;
  const bulan = filters.bulan.length > 0;
  const period = (y: number) => periodOf(y, filters.bulan, ytd, actualYears.has(y));
  return {
    monthsOf: (y) => period(y).months,
    actualMonthsOf: (y) => (bulan ? period(y).months : null),
    actualOkOf: (y) => actualYears.has(y) && !partLevel && !productBlocked && (!bulan || monthlyYears.has(y)),
    labelOf: (y) => period(y).label,
    whyNot: (y) =>
      partLevel
        ? "Actual tidak tersedia per Model / Part (data Actual sampai level Customer × Product)."
        : productBlocked
          ? "Data Actual tidak punya rincian Product."
          : bulan && !monthlyYears.has(y)
            ? "Actual tahun ini belum punya rincian bulanan (sinkron ulang dari web Sales untuk mengisinya)."
            : !actualYears.has(y)
              ? "Belum ada data Actual Sales untuk tahun ini."
              : ""
  };
}
