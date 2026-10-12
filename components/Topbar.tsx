"use client";

import type { Theme } from "@/hooks/useTheme";

export type Tab = "dashboard" | "summary" | "calculator";

type Props = {
  activeTab: Tab;
  setActiveTab: (t: Tab) => void;
  onOpenUpload: () => void;
  onOpenInfo: () => void;
  theme: Theme;
  cycleTheme: () => void;
  refreshing: boolean;
};

export default function Topbar({
  activeTab,
  setActiveTab,
  onOpenUpload,
  onOpenInfo,
  theme,
  cycleTheme,
  refreshing
}: Props) {
  const themeIcon = theme === "dark" ? "☾" : theme === "light" ? "☀" : "◐";
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-name">Market Size Dashboard</span>
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
        <button className="icon-btn" onClick={onOpenUpload} aria-label="Upload data">
          ⭱
        </button>
        <button className="icon-btn" onClick={onOpenInfo} aria-label="Info sumber data">
          ⓘ
        </button>
        <button className="icon-btn" onClick={cycleTheme} aria-label="Ganti tema">
          {themeIcon}
        </button>
      </div>
    </header>
  );
}
