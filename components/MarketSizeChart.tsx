"use client";

import { useEffect, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  BarController,
  LineElement,
  LineController,
  PointElement,
  Tooltip,
  Legend
} from "chart.js";
import { Chart } from "react-chartjs-2";
import type { UseDashboardState } from "@/hooks/useDashboardState";
import { fmtIDR, fmtIDRFull, fmtInt } from "@/lib/calculations";
import type { Theme } from "@/hooks/useTheme";

ChartJS.register(CategoryScale, LinearScale, BarElement, BarController, LineElement, LineController, PointElement, Tooltip, Legend);

const FALLBACK = { ink: "#47566A", blue: "#175596", red: "#AC1F2C", border: "#DCE2E9", surface: "#FFFFFF" };

export default function MarketSizeChart({ state, theme }: { state: UseDashboardState; theme: Theme }) {
  const { marketSizeYearRows, marketSizeView, setMarketSizeView } = state;
  const [colors, setColors] = useState(FALLBACK);

  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    setColors({
      ink: cs.getPropertyValue("--ink-soft").trim() || FALLBACK.ink,
      blue: cs.getPropertyValue("--blue-600").trim() || FALLBACK.blue,
      red: cs.getPropertyValue("--red-600").trim() || FALLBACK.red,
      border: cs.getPropertyValue("--border").trim() || FALLBACK.border,
      surface: cs.getPropertyValue("--surface").trim() || FALLBACK.surface
    });
  }, [theme]);

  const isQty = marketSizeView === "quantity";
  const labels = marketSizeYearRows.map((r) => String(r.year));
  const marketData = marketSizeYearRows.map((r) => (isQty ? r.market_qty : r.market_size));
  const actualData = marketSizeYearRows.map((r) => (isQty ? r.actual_qty : r.actual_sales));
  const partialYears = marketSizeYearRows.filter((r) => r.period_months < 12);
  const fmtVal = (v: number) => (isQty ? `${fmtInt(v)} pcs` : fmtIDRFull(v));

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>
          Market Size per Tahun
          {partialYears.length > 0 && (
            <span
              className="info-dot"
              title={`Tahun yang Actual Sales-nya belum penuh setahun dibandingkan dengan Market Size periode yang sama: ${partialYears
                .map((r) => `${r.year} (${r.period_months} bulan)`)
                .join(", ")}.`}
            >
              i
            </span>
          )}
        </h2>
        <div className="seg">
          <button
            type="button"
            className={`seg-btn${!isQty ? " active" : ""}`}
            onClick={() => setMarketSizeView("amount")}
          >
            Amount
          </button>
          <button
            type="button"
            className={`seg-btn${isQty ? " active" : ""}`}
            onClick={() => setMarketSizeView("quantity")}
          >
            Quantity
          </button>
        </div>
      </div>
      {labels.length === 0 ? (
        <div className="empty-hint" style={{ margin: 0 }}>
          Belum ada Data UIO atau Actual Sales yang diupload, jadi Market Size per tahun belum bisa dihitung.
        </div>
      ) : (
        <div className="chart-wrap-tall">
          <Chart
            type="bar"
            data={{
              labels,
              datasets: [
                {
                  type: "bar" as const,
                  label: isQty ? "Actual sales (qty)" : "Actual sales",
                  data: actualData,
                  backgroundColor: colors.red,
                  borderRadius: 4,
                  order: 2,
                  maxBarThickness: 24,
                  categoryPercentage: 0.5,
                  barPercentage: 0.9
                },
                {
                  type: "line" as const,
                  label: isQty ? "Market size (qty)" : "Market size",
                  data: marketData,
                  borderColor: colors.blue,
                  backgroundColor: colors.blue,
                  borderWidth: 2,
                  tension: 0.3,
                  pointRadius: 4,
                  pointBorderWidth: 2,
                  pointBorderColor: colors.surface,
                  order: 1
                }
              ]
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              interaction: { mode: "index", intersect: false },
              plugins: {
                legend: { position: "bottom", labels: { color: colors.ink, boxWidth: 12, padding: 16 } },
                tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtVal(c.parsed.y as number)}` } }
              },
              scales: {
                x: { ticks: { color: colors.ink }, grid: { display: false } },
                y: {
                  beginAtZero: true,
                  ticks: {
                    color: colors.ink,
                    maxTicksLimit: 6,
                    callback: (v) => (isQty ? fmtInt(v as number) : fmtIDR(v as number))
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
