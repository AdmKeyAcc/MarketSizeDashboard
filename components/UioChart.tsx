"use client";

import { useEffect, useState } from "react";
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, BarController, Tooltip, Legend } from "chart.js";
import { Chart } from "react-chartjs-2";
import type { UseDashboardState } from "@/hooks/useDashboardState";
import { fmtInt, UIO_DIMENSIONS, UIO_DIMENSION_LABELS } from "@/lib/calculations";
import type { Theme } from "@/hooks/useTheme";

ChartJS.register(CategoryScale, LinearScale, BarElement, BarController, Tooltip, Legend);

const FALLBACK = { ink: "#47566A", blue: "#175596", border: "#DCE2E9" };

export default function UioChart({ state, theme }: { state: UseDashboardState; theme: Theme }) {
  const { uioByProductRows, uioYears, uioDimension, setUioDimension } = state;
  const [colors, setColors] = useState(FALLBACK);

  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    setColors({
      ink: cs.getPropertyValue("--ink-soft").trim() || FALLBACK.ink,
      blue: cs.getPropertyValue("--blue-600").trim() || FALLBACK.blue,
      border: cs.getPropertyValue("--border").trim() || FALLBACK.border
    });
  }, [theme]);

  const labels = uioByProductRows.map((r) => r.label);
  const values = uioByProductRows.map((r) => r.uio);

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>
          UIO per {UIO_DIMENSION_LABELS[uioDimension]}
          <span className="info-dot" title="UIO = jumlah unit yang beroperasi (unit in operation).">i</span>
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div className="seg">
            {UIO_DIMENSIONS.map((d) => (
              <button
                key={d}
                type="button"
                className={`seg-btn${uioDimension === d ? " active" : ""}`}
                onClick={() => setUioDimension(d)}
              >
                {UIO_DIMENSION_LABELS[d]}
              </button>
            ))}
          </div>
          <span className="note">{uioYears.length > 0 ? `Tahun ${uioYears.join(", ")}` : "Belum ada data UIO"}</span>
        </div>
      </div>
      {labels.length === 0 ? (
        <div className="empty-hint" style={{ margin: 0 }}>
          Belum ada Data UIO yang diupload. Klik ⭱ di atas untuk upload Data UIO.
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
                  label: "UIO (unit)",
                  data: values,
                  backgroundColor: colors.blue,
                  borderRadius: 4,
                  maxBarThickness: 46
                }
              ]
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (c) => `UIO: ${fmtInt(c.parsed.y as number)} unit` } }
              },
              scales: {
                x: { ticks: { color: colors.ink }, grid: { display: false } },
                y: {
                  beginAtZero: true,
                  ticks: { color: colors.ink, maxTicksLimit: 6, callback: (v) => fmtInt(v as number) },
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
