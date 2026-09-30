"use client";

import type { UseDashboardState } from "@/hooks/useDashboardState";
import { fmtIDR, fmtPct } from "@/lib/calculations";

export default function KpiCards({ state }: { state: UseDashboardState }) {
  const { monthlyAgg, months, filters } = state;

  const ms = monthlyAgg.reduce((s, r) => s + r.market_size_scaled, 0);
  const act = monthlyAgg.reduce((s, r) => s + r.actual_sales_scaled, 0);
  const achievement = ms > 0 ? act / ms : NaN;
  const gap = ms - act;

  const year = filters.tahun.length === 0 ? "2026" : filters.tahun.join(", ");
  const periodLabel =
    months.length === 0
      ? "–"
      : filters.bulan.length === 0
      ? `${months[0]}–${months[months.length - 1]} ${year}`
      : `${filters.bulan.join(", ")} ${year}`;

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
        <div className="kpi-label">Achievement</div>
        <div className="kpi-value mono">{fmtPct(achievement)}</div>
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
