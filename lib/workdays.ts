import { refs } from "@/lib/references";
import { monthIdx } from "@/lib/period";

/**
 * Hari kerja per bulan sekarang dibaca dari tabel app_settings (workdays_01..workdays_12),
 * bawaan: 22, 20, 22, 22, 21, 22, 23, 21, 22, 22, 21, 22.
 * Fungsi di bawah hanya dipakai rumus lama (tanpa Actual tahunan) — perhitungan utama memakai
 * jam operasi per bulan (lib/calculations.ts → addUnitHm).
 */
export function monthsShare(months: Iterable<string>): number {
  const wd = refs().settings.workdays_by_month;
  const total = wd.reduce((a, b) => a + b, 0);
  const seen = new Set<number>();
  for (const m of months) {
    const i = monthIdx(m);
    if (i >= 0 && i < 12) seen.add(i);
  }
  let days = 0;
  seen.forEach((i) => (days += wd[i]));
  return total > 0 ? days / total : 0;
}
