"use client";

import type { UseDashboardState } from "@/hooks/useDashboardState";
import { fmtIDR, fmtPct } from "@/lib/calculations";

export default function KpiCards({ state }: { state: UseDashboardState }) {
  const { marketSizeYearRows, filters } = state;

  // Jumlah dari semua tahun yang sedang tampil di chart (semua tahun kalau
  // filter Tahun kosong), untuk periode yang sama antara Market Size dan Actual Sales.
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
        <div className="kpi-value mono">{comparable ? fmtIDR(act) : "–"}</div>
        <div className="kpi-sub" title={state.data.actualExcluded.products.length > 0 ? `Tidak dihitung (belum ada Market Size): ${state.data.actualExcluded.products.join(", ")}` : undefined}>
          {comparable ? `${periodLabel} · produk ber-Master Part` : whyNot}
        </div>
      </div>
      <div className="kpi green">
        <div className="kpi-label">Market Share</div>
        <div className="kpi-value mono">{fmtPct(marketShare)}</div>
        <div className="kpi-sub">{comparable ? "Actual sales ÷ market size" : "Perlu Actual yang sebanding"}</div>
      </div>
      <div className="kpi">
        <div className="kpi-label">Gap (peluang)</div>
        <div className="kpi-value mono">{comparable ? fmtIDR(gap) : "–"}</div>
        <div className="kpi-sub">{comparable ? "Market size − actual sales" : "Perlu Actual yang sebanding"}</div>
      </div>
    </div>
  );
}
