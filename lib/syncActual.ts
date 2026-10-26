/** Sinkron Actual Sales dari web Sales, dijalankan dari browser (tombol di modal Upload).
 * Pekerjaan dipecah per tahun & per bulan supaya tiap panggilan API selesai di bawah batas waktu Vercel. */

type Info = { min_year: number | null; max_year: number | null; max_date: string | null; rows: number };
export type SyncResult = { ok: boolean; message: string };

const URL = "/api/sync/actual-sales";

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
  return json as T;
}

const fmt = (n: number) => n.toLocaleString("id-ID");

/**
 * mode "recent": tahun terakhir di data Sales (plus tahun sebelumnya kalau data baru sampai Jan–Feb).
 * mode "all"   : semua tahun sejak data paling awal (sekali saja, butuh beberapa menit).
 */
export async function syncActualSales(mode: "recent" | "all", onProgress?: (t: string) => void): Promise<SyncResult> {
  try {
    onProgress?.("Membaca rentang data di web Sales…");
    const { info, exclude } = await call<{ info: Info; exclude: string[] }>({ unit: "info" });
    if (!info.max_year || !info.min_year) return { ok: false, message: "Data Sales kosong." };
    const maxDate = info.max_date ? new Date(info.max_date) : null;
    const lastMonth = maxDate && maxDate.getUTCFullYear() === info.max_year ? maxDate.getUTCMonth() + 1 : 12;

    const years: number[] = [];
    const first = mode === "all" ? info.min_year : lastMonth <= 2 ? info.max_year - 1 : info.max_year;
    for (let y = first; y <= info.max_year; y++) years.push(y);

    // Unit kerja: ringkasan tahunan dulu (yang dipakai dashboard), lalu per bulan (per part).
    const units: { unit: "year" | "month"; year: number; month?: number }[] = [];
    years.forEach((y) => units.push({ unit: "year", year: y }));
    years.forEach((y) => {
      const last = y === info.max_year ? lastMonth : 12;
      for (let m = 1; m <= last; m++) units.push({ unit: "month", year: y, month: m });
    });

    let done = 0;
    let yearRows = 0;
    let txRows = 0;
    const totals = new Map<number, number>();
    const errors: string[] = [];
    const CONCURRENCY = 3;
    for (let i = 0; i < units.length; i += CONCURRENCY) {
      await Promise.all(
        units.slice(i, i + CONCURRENCY).map(async (u) => {
          try {
            const r = await call<{ rows: number; total?: number }>(u);
            if (u.unit === "year") {
              yearRows += r.rows;
              totals.set(u.year, r.total || 0);
            } else txRows += r.rows;
          } catch (err) {
            errors.push(`${u.unit === "year" ? `Tahun ${u.year}` : `${u.month}/${u.year}`}: ${(err as Error).message}`);
          }
          done++;
          onProgress?.(`Sinkron ${done} / ${units.length} bagian (tahun ${years[0]}–${years[years.length - 1]})…`);
        })
      );
    }

    const lastTotal = totals.get(info.max_year);
    const summary =
      `Tahun ${years[0]}–${info.max_year}: ${fmt(yearRows)} baris Actual per customer` +
      `${txRows ? ` dan ${fmt(txRows)} baris Actual per part/bulan` : ""}. ` +
      `Data terakhir ${info.max_date ?? "-"}` +
      `${lastTotal !== undefined ? `; total ${info.max_year} = Rp ${fmt(Math.round(lastTotal))}` : ""}. ` +
      `Cabang dikecualikan: ${exclude.length ? exclude.join(", ") : "tidak ada"}.`;
    if (errors.length > 0) {
      return { ok: false, message: `${errors.length} bagian gagal — ${errors.slice(0, 3).join(" · ")}${errors.length > 3 ? " …" : ""}. ${summary}` };
    }
    return { ok: true, message: summary };
  } catch (err) {
    return { ok: false, message: (err as Error).message || "Sinkron gagal." };
  }
}
