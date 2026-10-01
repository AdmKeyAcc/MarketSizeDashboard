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
import { fmtIDR, fmtIDRFull } from "@/lib/calculations";
import type { Theme } from "@/hooks/useTheme";

ChartJS.register(CategoryScale, LinearScale, BarElement, BarController, LineElement, LineController, PointElement, Tooltip, Legend);

const FALLBACK = { ink: "#47566A", blue: "#175596", red: "#AC1F2C", border: "#DCE2E9" };

export default function MarketSizeChart({ state, theme }: { state: UseDashboardState; theme: Theme }) {
  const { marketSizeYearRows, marketSizeView, setMarketSizeView, actualSalesMonthRows, singleYear } = state;
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

  const isBulanan = marketSizeView === "bulan";

  // Tahunan: Market Size (garis) + Actual Sales (bar), X = Tahun.
  const yearLabels = marketSizeYearRows.map((r) => String(r.year));
  const msData = marketSizeYearRows.map((r) => r.market_size);
  const actYearData = marketSizeYearRows.map((r) => r.actual_sales);

  // Bulanan: hanya Actual Sales (Market Size tidak tersedia per bulan,
  // karena Data UIO sumbernya cuma granular per tahun), X = Bulan, untuk
  // satu tahun yang dipilih di filter Tahun.
  const monthLabels = actualSalesMonthRows.map((r) => r.month);
  const actMonthData = actualSalesMonthRows.map((r) => r.actual_sales);

  const labels = isBulanan ? monthLabels : yearLabels;
  const noData = isBulanan ? singleYear === null : yearLabels.length === 0;

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Market Size {isBulanan ? "" : "per Tahun"}</h2>
        <div className="seg">
          <button
            type="button"
            className={`seg-btn${!isBulanan ? " active" : ""}`}
            onClick={() => setMarketSizeView("tahun")}
          >
            Tahunan
          </button>
          <button
            type="button"
            className={`seg-btn${isBulanan ? " active" : ""}`}
            onClick={() => setMarketSizeView("bulan")}
          >
            Bulanan
          </button>
        </div>
      </div>
      {noData ? (
        <div className="empty-hint" style={{ margin: 0 }}>
          {isBulanan
            ? "Pilih tepat satu Tahun di filter untuk melihat Actual Sales per bulan (Market Size tidak tersedia per bulan karena Data UIO hanya per tahun)."
            : "Belum ada Data UIO yang diupload, jadi Market Size per tahun belum bisa dihitung."}
        </div>
      ) : isBulanan ? (
        <div className="chart-wrap">
          <Chart
            type="bar"
            data={{
              labels: monthLabels,
              datasets: [
                {
                  type: "bar" as const,
                  label: `Actual sales ${singleYear}`,
                  data: actMonthData,
                  backgroundColor: colors.red,
                  borderRadius: 4,
                  maxBarThickness: 46
                }
              ]
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
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
                  data: actYearData,
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
