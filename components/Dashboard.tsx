"use client";

import { useState } from "react";
import type { DashboardData } from "@/lib/types";
import { useDashboardState } from "@/hooks/useDashboardState";
import { useCalculatorSummary } from "@/hooks/useCalculatorSummary";
import { useTheme } from "@/hooks/useTheme";
import Topbar from "@/components/Topbar";
import FilterBar from "@/components/FilterBar";
import KpiCards from "@/components/KpiCards";
import UioChart from "@/components/UioChart";
import MarketSizeChart from "@/components/MarketSizeChart";
import MarketShareChart from "@/components/MarketShareChart";
import Calculator from "@/components/Calculator";
import UploadModal from "@/components/UploadModal";
import InfoModal from "@/components/InfoModal";

export default function Dashboard({ initialData }: { initialData: DashboardData }) {
  const state = useDashboardState(initialData);
  const summaryState = useCalculatorSummary();
  const { theme, cycleTheme } = useTheme();

  const [activeTab, setActiveTab] = useState<"dashboard" | "kalkulator">("dashboard");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const hasData = state.data.parts.length > 0;

  return (
    <div className="app">
      <Topbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenUpload={() => setUploadOpen(true)}
        onOpenInfo={() => setInfoOpen(true)}
        theme={theme}
        cycleTheme={cycleTheme}
        refreshing={state.refreshing}
      />

      <FilterBar state={state} />

      <div className="main">
        {!hasData && (
          <div className="empty-hint">
            Belum ada data part di database. Klik ⭱ di atas untuk upload template kalkulator, atau jalankan{" "}
            <code>scripts/seed.mjs</code> untuk mengisi data contoh.
          </div>
        )}

        {activeTab === "dashboard" ? (
          <section className="view">
            <KpiCards state={state} />
            <UioChart state={state} theme={theme} />
            <MarketSizeChart state={state} theme={theme} />
            <MarketShareChart state={state} theme={theme} />
          </section>
        ) : (
          <section className="view">
            <Calculator state={state} summaryState={summaryState} />
          </section>
        )}
      </div>

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={state.refetch} />
      <InfoModal open={infoOpen} onClose={() => setInfoOpen(false)} meta={state.data.meta} />
    </div>
  );
}
