"use client";

import { useState, useEffect, useCallback } from "react";

const LS_KEY = "tn_ms_theme";
export type Theme = "auto" | "light" | "dark";

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("auto");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY) as Theme | null;
      if (saved) applyTheme(saved);
    } catch {
      // ignore
    }
  }, []);

  function applyTheme(t: Theme) {
    setThemeState(t);
    if (t === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
  }

  const cycleTheme = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : theme === "light" ? "auto" : "dark";
    applyTheme(next);
    try {
      localStorage.setItem(LS_KEY, next);
    } catch {
      // ignore
    }
  }, [theme]);

  return { theme, cycleTheme };
}
