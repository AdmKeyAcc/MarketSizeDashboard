"use client";

import type { Theme } from "@/hooks/useTheme";
import { LOGO_DATA_URI } from "@/components/logoData";

export type Tab = "dashboard" | "summary" | "calculator";

type Props = {
  activeTab: Tab;
  setActiveTab: (t: Tab) => void;
  onOpenUpload: () => void;
  theme: Theme;
  cycleTheme: () => void;
  refreshing: boolean;
};

export default function Topbar({
  activeTab,
  setActiveTab,
  onOpenUpload,
  theme,
  cycleTheme,
  refreshing
}: Props) {
  const themeIcon = theme === "dark" ? "☾" : theme === "light" ? "☀" : "◐";
  return (
    <header className="topbar">
      <div className="brand">
        <img src={LOGO_DATA_URI} width={32} height={32} alt="TRAKNUS" style={{ flexShrink: 0, objectFit: "contain" }} />
        {refreshing && <span className="spinner" aria-label="Memuat ulang" />}
      </div>
      <nav className="tabs">
        <button
          className={"tab" + (activeTab === "dashboard" ? " active" : "")}
          onClick={() => setActiveTab("dashboard")}
        >
          Dashboard
        </button>
        <button
          className={"tab" + (activeTab === "summary" ? " active" : "")}
          onClick={() => setActiveTab("summary")}
        >
          Summary
        </button>
        <button
          className={"tab" + (activeTab === "calculator" ? " active" : "")}
          onClick={() => setActiveTab("calculator")}
        >
          Calculator
        </button>
      </nav>
      <div className="top-actions">
        <button className="icon-btn icon-btn-labeled" onClick={onOpenUpload} aria-label="Upload data">
          <span>⭱</span>
          <span className="btn-label">Upload Data</span>
        </button>
        <button className="icon-btn" onClick={cycleTheme} aria-label="Ganti tema">
          {themeIcon}
        </button>
      </div>
    </header>
  );
}
