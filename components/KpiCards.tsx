"use client";

import type { UseDashboardState } from "@/hooks/useDashboardState";
import { fmtPct } from "@/lib/calculations";

/** Rupiah untuk kartu KPI: satuan ditulis lengkap (Miliar / Juta) supaya "M" tidak terbaca "juta". */
function Rp({ n }: { n: number }) {
  if (!Number.isFinite(n)) return <>–</>;
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  const [v, unit] = a >= 1e12 ? [a / 1e12, "Triliun"] : a >= 1e9 ? [a / 1e9, "Miliar"] : a >= 1e6 ? [a / 1e6, "Juta"] : [a, ""];
  const num = v.toLocaleString("id-ID", { maximumFractionDigits: unit ? 2 : 0 });
  return (
    <>
      <span className="kpi-num">{`${sign}Rp ${num}`}</span>
      {unit && <span className="kpi-unit"> {unit}</span>}
    </>
  );
}

export default function KpiCards({ state }: { state: UseDashboardState }) {
  const { marketSizeYearRows } = state;

  // Jumlah dari semua tahun yang sedang tampil di chart (semua tahun kalau filter Tahun kosong = All),
  // untuk periode yang sama antara Market Size dan Actual Sales. All = semua tahun dicentang.
  const ms = marketSizeYearRows.reduce((s, r) => s + r.market_size, 0);
  const act = marketSizeYearRows.reduce((s, r) => s + r.actual_sales, 0);
  const comparable = marketSizeYearRows.every((r) => r.actual_comparable !== false);
  const marketShare = comparable && ms > 0 ? act / ms : NaN;
  const gap = ms - act;

  // Alasan Actual tidak bisa dibandingkan — aturan yang sama dengan chart & tabel hierarki (lib/period.ts).
  const notOk = marketSizeYearRows.find((r) => r.actual_comparable === false);
  const whyNot = (notOk ? state.plan.whyNot(notOk.year) : "") || "Belum ada data Actual Sales untuk periode ini.";

  if (state.marketComputing) {
    const pct = state.factsProgress !== null ? ` ${Math.round(state.factsProgress * 100)}%` : "";
    const card = (cls: string, label: string) => (
      <div className={"kpi " + cls}>
        <div className="kpi-label">{label}</div>
        <div className="kpi-value mono kpi-loading">…</div>
        <div className="kpi-sub">Menghitung{pct}</div>
      </div>
    );
    return (
      <div className="kpis">
        {card("blue", "Market size")}
        {card("red", "Actual sales")}
        {card("green", "Market Share")}
        {card("", "Gap (peluang)")}
      </div>
    );
  }

  // Kartu KPI hanya menampilkan angka (keterangan di bawah angka dihapus atas permintaan pengguna);
  // pesan tetap muncul kalau Actual belum sebanding untuk periode ini.
  return (
    <div className="kpis">
      <div className="kpi blue">
        <div className="kpi-label">Market Size</div>
        <div className="kpi-value mono"><Rp n={ms} /></div>
      </div>
      <div className="kpi red">
        <div className="kpi-label">Actual Sales</div>
        <div className="kpi-value mono">{comparable ? <Rp n={act} /> : "–"}</div>
        {!comparable && <div className="kpi-sub">{whyNot}</div>}
      </div>
      <div className="kpi green">
        <div className="kpi-label">Market Share</div>
        <div className="kpi-value mono">{fmtPct(marketShare)}</div>
      </div>
      <div className="kpi">
        <div className="kpi-label">Gap (Opportunity)</div>
        <div className="kpi-value mono">{comparable ? <Rp n={gap} /> : "–"}</div>
      </div>
    </div>
  );
}
