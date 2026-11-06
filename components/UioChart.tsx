"use client";

import { useEffect, useState } from "react";
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, BarController, Tooltip, Legend } from "chart.js";
import { Chart } from "react-chartjs-2";
import type { UseDashboardState } from "@/hooks/useDashboardState";
import { fmtInt } from "@/lib/calculations";
import type { Theme } from "@/hooks/useTheme";

ChartJS.register(CategoryScale, LinearScale, BarElement, BarController, Tooltip, Legend);

const FALLBACK = { ink: "#47566A", blue: "#175596", border: "#DCE2E9" };

export default function UioChart({ state, theme }: { state: UseDashboardState; theme: Theme }) {
  const { uioByProductRows, uioFilters, uioUnitsScoped } = state;
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
          UIO per Product
          <span className="info-dot" title="UIO = jumlah unit yang beroperasi (unit in operation) di Data UIO, sesuai Filter UIO. Year BAST = tahun BAST unit (Berita Acara Serah Terima, yaitu dokumen saat unit diserahterimakan ke customer); All = semua unit.">i</span>
        </h2>
        <span className="note">
          {uioUnitsScoped.length > 0
            ? `${uioUnitsScoped.length.toLocaleString("id-ID")} unit · Year BAST: ${uioFilters.yearBast.length === 0 ? "All" : uioFilters.yearBast.join(", ")}`
            : "Belum ada data UIO"}
        </span>
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
                  maxBarThickness: 24,
                  categoryPercentage: 0.6,
                  barPercentage: 0.9
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
