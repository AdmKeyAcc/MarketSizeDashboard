import { MONTH_ORDER } from "@/lib/types";

/**
 * Hari kerja per bulan (Januari → Desember). Dipakai untuk membagi Market Size
 * setahun ke tiap bulan: bulan dengan hari kerja lebih sedikit (mis. Februari)
 * mendapat bagian lebih kecil.
 *
 *   Market Size bulan m = Market Size setahun × hari kerja bulan m ÷ total hari kerja 12 bulan
 *
 * Total setahun TIDAK berubah — hanya pembagiannya ke bulan yang berbeda.
 * Ubah angka di bawah kalau kalender kerja berbeda (mis. potong libur nasional / cuti bersama).
 * Kalau semua bulan diisi angka sama, hasilnya kembali seperti rumus lama (setahun ÷ 12 per bulan).
 */
export const WORKDAYS_PER_MONTH: number[] = [22, 20, 22, 22, 21, 22, 23, 21, 22, 22, 21, 22];

const TOTAL = WORKDAYS_PER_MONTH.reduce((a, b) => a + b, 0);

function idxOf(m: string): number {
  const i = (MONTH_ORDER as readonly string[]).findIndex((x) => x.toLowerCase() === String(m || "").trim().toLowerCase());
  return i;
}

/** Bagian (0–1) dari Market Size setahun untuk sekumpulan bulan, berdasarkan hari kerja. */
export function monthsShare(months: Iterable<string>): number {
  const seen = new Set<number>();
  for (const m of months) {
    const i = idxOf(m);
    if (i >= 0 && i < 12) seen.add(i);
  }
  let days = 0;
  seen.forEach((i) => (days += WORKDAYS_PER_MONTH[i]));
  return TOTAL > 0 ? days / TOTAL : 0;
}
