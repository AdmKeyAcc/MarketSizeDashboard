"use client";

import { useEffect, useState } from "react";
import { Chart as ChartJS, CategoryScale, LinearScale, LineElement, LineController, PointElement, Tooltip, Legend } from "chart.js";
import { Chart } from "react-chartjs-2";
import type { UseDashboardState } from "@/hooks/useDashboardState";
import { fmtPct } from "@/lib/calculations";
import type { Theme } from "@/hooks/useTheme";

ChartJS.register(CategoryScale, LinearScale, LineElement, LineController, PointElement, Tooltip, Legend);

const FALLBACK = { ink: "#47566A", green: "#227A46", border: "#DCE2E9", surface: "#FFFFFF" };

export default function MarketShareChart({ state, theme }: { state: UseDashboardState; theme: Theme }) {
  const monthly = state.chartMonthly;
  const marketSizeYearRows = monthly ? monthly.rows : state.marketSizeYearRows;
  const marketShareYearRows = monthly
    ? monthly.rows.map((r) => ({ year: r.year, market_share: r.market_size > 0 ? r.actual_sales / r.market_size : 0, period_months: 1 }))
    : state.marketShareYearRows;
  const [colors, setColors] = useState(FALLBACK);

  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    setColors({
      ink: cs.getPropertyValue("--ink-soft").trim() || FALLBACK.ink,
      green: cs.getPropertyValue("--green-600").trim() || FALLBACK.green,
      border: cs.getPropertyValue("--border").trim() || FALLBACK.border,
      surface: cs.getPropertyValue("--surface").trim() || FALLBACK.surface
    });
  }, [theme]);

  const hasActual = (!monthly || monthly.actualOk) && marketSizeYearRows.some((r) => r.actual_sales > 0);
  const labels = monthly ? monthly.rows.map((r) => r.label) : marketShareYearRows.map((r) => state.plan.labelOf(r.year));
  const values = marketShareYearRows.map((r) => r.market_share * 100);

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>
          {monthly ? `Market Share per Month · ${monthly.year}` : "Market Share per Year"}
          <span className="info-dot" title="Market share = Actual Sales ÷ Market Size (persentase), untuk periode yang sama.">i</span>
        </h2>
      </div>
      {state.marketComputing ? (
        <div className="empty-hint" style={{ margin: 0 }}>
          Menghitung Market Size per customer…{state.factsProgress !== null ? ` ${Math.round(state.factsProgress * 100)}%` : ""}
        </div>
      ) : labels.length > 0 && !hasActual ? (
        <div className="empty-hint" style={{ margin: 0 }}>
          {(() => {
            if (monthly && !monthly.actualOk && state.plan.actualOkOf(monthly.year))
              return "Actual tahun ini belum punya rincian bulanan, jadi Market Share per bulan belum bisa dihitung.";
            const bad = marketSizeYearRows.find((r) => r.actual_comparable === false);
            return bad ? state.plan.whyNot(bad.year) : "Belum ada data Actual Sales untuk filter ini, jadi Market Share belum bisa dihitung.";
          })()}
        </div>
      ) : labels.length === 0 ? (
        <div className="empty-hint" style={{ margin: 0 }}>
          Belum ada Data UIO atau Actual Sales yang diupload, jadi Market Share per tahun belum bisa dihitung.
        </div>
      ) : (
        <div className="chart-wrap-tall">
          <Chart
            type="line"
            data={{
              labels,
              datasets: [
                {
                  label: "Market share",
                  data: values,
                  borderColor: colors.green,
                  backgroundColor: colors.green,
                  borderWidth: 2,
                  tension: 0.3,
                  pointRadius: 4,
                  pointBorderWidth: 2,
                  pointBorderColor: colors.surface
                }
              ]
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (c) => `Market share: ${fmtPct((c.parsed.y as number) / 100)}` } }
              },
              scales: {
                x: { ticks: { color: colors.ink }, grid: { display: false } },
                y: {
                  beginAtZero: true,
                  ticks: {
                    color: colors.ink,
                    maxTicksLimit: 6,
                    callback: (v) => `${Math.round(v as number).toLocaleString("id-ID")}%`
                  },
                  grid: { color: colors.border, drawTicks: false },
                  border: { display: false }
                }
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
