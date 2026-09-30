"use client";

import { useEffect, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend
} from "chart.js";
import { Chart } from "react-chartjs-2";
import type { UseDashboardState } from "@/hooks/useDashboardState";
import { fmtIDR, fmtIDRFull } from "@/lib/calculations";
import type { Theme } from "@/hooks/useTheme";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend);

const FALLBACK = { ink: "#47566A", blue: "#175596", red: "#AC1F2C", border: "#DCE2E9" };

export default function MarketSizeChart({ state, theme }: { state: UseDashboardState; theme: Theme }) {
  const { marketSizeYearRows } = state;
  const [colors, setColors] = useState(FALLBACK);

  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    setColors({
      ink: cs.getPropertyValue("--ink-soft").trim() || FALLBACK.ink,
      blue: cs.getPropertyValue("--blue-600").trim() || FALLBACK.blue,
      red: cs.getPropertyValue("--red-600").trim() || FALLBACK.red,
      border: cs.getPropertyValue("--border").trim() || FALLBACK.border
    });
  }, [theme]);

  const labels = marketSizeYearRows.map((r) => String(r.year));
  const msData = marketSizeYearRows.map((r) => r.market_size);
  const actData = marketSizeYearRows.map((r) => r.actual_sales);

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Market Size vs Actual Sales — per Tahun</h2>
      </div>
      {labels.length === 0 ? (
        <div className="empty-hint" style={{ margin: 0 }}>
          Belum ada Data UIO yang diupload, jadi Market Size per tahun belum bisa dihitung.
        </div>
      ) : (
        <div className="chart-wrap">
          <Chart
            type="bar"
            data={{
              labels,
              datasets: [
                {
                  type: "bar" as const,
                  label: "Actual sales",
                  data: actData,
                  backgroundColor: colors.red,
                  borderRadius: 4,
                  order: 2,
                  maxBarThickness: 46
                },
                {
                  type: "line" as const,
                  label: "Market size",
                  data: msData,
                  borderColor: colors.blue,
                  backgroundColor: colors.blue,
                  tension: 0.3,
                  pointRadius: 3,
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
                tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtIDRFull(c.parsed.y as number)}` } }
              },
              scales: {
                x: { ticks: { color: colors.ink }, grid: { display: false } },
                y: { ticks: { color: colors.ink, callback: (v) => fmtIDR(v as number) }, grid: { display: false } }
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
