"use client";

import { useMemo, useState } from "react";
import { buildTemplateLists } from "@/lib/templateLists";
import type { DashboardData } from "@/lib/types";
import { useDashboardState } from "@/hooks/useDashboardState";
import { useCalculatorSummary } from "@/hooks/useCalculatorSummary";
import { useTheme } from "@/hooks/useTheme"; 
import Topbar, { type Tab } from "@/components/Topbar";
import FilterBar, { UioFilterBar } from "@/components/FilterBar";
import KpiCards from "@/components/KpiCards";
import UioChart from "@/components/UioChart";
import UioDetailTable from "@/components/UioDetailTable";
import MarketSizeChart from "@/components/MarketSizeChart";
import MarketShareChart from "@/components/MarketShareChart";
import HierarchyTable from "@/components/HierarchyTable";
import Calculator from "@/components/Calculator";
import GroupSummary from "@/components/GroupSummary";
import UploadModal from "@/components/UploadModal";

export default function Dashboard({ initialData }: { initialData: DashboardData }) {
  const state = useDashboardState(initialData);
  const summaryState = useCalculatorSummary();
  const { theme, cycleTheme } = useTheme();

  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [uploadOpen, setUploadOpen] = useState(false);

  const hasData = state.data.parts.length > 0;
  // Daftar dropdown template hanya dihitung saat modal Upload dibuka.
  const templateLists = useMemo(() => (uploadOpen ? buildTemplateLists(state.data) : undefined), [uploadOpen, state.data]);

  return (
    <div className="app">
      <Topbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenUpload={() => setUploadOpen(true)}
        theme={theme}
        cycleTheme={cycleTheme}
        refreshing={state.refreshing}
      />


      <div className="main">
        {!hasData && (
          <div className="empty-hint">
            Belum ada data part di database. Klik ⭱ di atas untuk upload Master Part, atau jalankan{" "}
            <code>scripts/seed.mjs</code> untuk mengisi data contoh.
          </div>
        )}

        {activeTab === "dashboard" ? (
          <section className="view">
            {/* ---- Bagian Market: Filter Market → scorecard, chart, hierarchy ---- */}
            <FilterBar state={state} />
            <KpiCards state={state} />
            <div className="charts-row2">
              <MarketSizeChart state={state} theme={theme} />
              <MarketShareChart state={state} theme={theme} />
            </div>
            <HierarchyTable state={state} />
            {/* ---- Bagian UIO: Filter UIO → chart & detail UIO ---- */}
            <div className="section-divider" />
            <UioFilterBar state={state} />
            <UioChart state={state} theme={theme} />
            <UioDetailTable state={state} />
          </section>
        ) : activeTab === "summary" ? (
          <section className="view">
            <GroupSummary state={state} />
          </section>
        ) : (
          <section className="view">
            <Calculator state={state} summaryState={summaryState} />
          </section>
        )}
      </div>

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={state.refetch}
        meta={state.data.meta}
        lists={templateLists}
        counts={{
          parts: state.data.parts.length,
          uioUnits: state.data.uioUnits.length,
          contractPrices: state.data.priceList.filter((p) => p.price_type === "contract" || p.price_type === "scpl").length,
          nonContractPrices: state.data.priceList.filter((p) => p.price_type !== "contract" && p.price_type !== "scpl").length,
          actualSales: state.data.actualSalesYear.length
        }}
      />
    </div>
  );
}
