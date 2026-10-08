"use client";

import type { UseDashboardState } from "@/hooks/useDashboardState";
import { fmtIDR, fmtPct } from "@/lib/calculations";

export default function KpiCards({ state }: { state: UseDashboardState }) {
  const { marketSizeYearRows, filters } = state;

  // Jumlah dari semua tahun yang sedang tampil di chart (semua tahun kalau
  // filter Tahun kosong), untuk periode yang sama antara Market Size dan Actual Sales.
  const ms = marketSizeYearRows.reduce((s, r) => s + r.market_size, 0);
  const act = marketSizeYearRows.reduce((s, r) => s + r.actual_sales, 0);
  const marketShare = ms > 0 ? act / ms : NaN;
  const gap = ms - act;

  const years = marketSizeYearRows.map((r) => r.year);
  const yearLabel =
    years.length === 0
      ? "–"
      : years.length === 1
      ? String(years[0])
      : `${years[0]}–${years[years.length - 1]}`;
  const periodLabel = filters.bulan.length > 0 ? `${yearLabel} · ${filters.bulan.join(", ")}` : yearLabel;

  return (
    <div className="kpis">
      <div className="kpi blue">
        <div className="kpi-label">Market size</div>
        <div className="kpi-value mono">{fmtIDR(ms)}</div>
        <div className="kpi-sub">{periodLabel}</div>
      </div>
      <div className="kpi red">
        <div className="kpi-label">Actual sales</div>
        <div className="kpi-value mono">{fmtIDR(act)}</div>
        <div className="kpi-sub">{periodLabel}</div>
      </div>
      <div className="kpi green">
        <div className="kpi-label">Market Share</div>
        <div className="kpi-value mono">{fmtPct(marketShare)}</div>
        <div className="kpi-sub">Actual sales ÷ market size</div>
      </div>
      <div className="kpi">
        <div className="kpi-label">Gap (peluang)</div>
        <div className="kpi-value mono">{fmtIDR(gap)}</div>
        <div className="kpi-sub">Market size − actual sales</div>
      </div>
    </div>
  );
}
