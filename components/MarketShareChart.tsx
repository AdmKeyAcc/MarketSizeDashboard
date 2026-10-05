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
  const { marketShareYearRows } = state;
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

  const labels = marketShareYearRows.map((r) => String(r.year));
  const values = marketShareYearRows.map((r) => r.market_share * 100);

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Market Share per Tahun</h2>
      </div>
      {labels.length === 0 ? (
        <div className="empty-hint" style={{ margin: 0 }}>
          Belum ada Data UIO yang diupload, jadi Market Share per tahun belum bisa dihitung.
        </div>
      ) : (
        <div className="chart-wrap-compact">
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
      {labels.length > 0 && marketShareYearRows.some((r) => r.estimated) && (
        <p className="chart-note">
          Perhitungan sementara: Market Size memakai UIO dari unit tanpa tahun / template kalkulator untuk tahun yang
          belum punya Data UIO bertahun — bentuk grafik masih indikatif.
        </p>
      )}
    </div>
  );
}
