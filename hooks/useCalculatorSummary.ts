"use client";

import { useState, useCallback, useEffect } from "react";
import type { CalcSummaryItem } from "@/lib/types";

const LS_KEY = "tn_ms_calc_summary";

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {
    // fall through to the manual id below
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Holds the list of parts the user has "added" from the Quick Calculator
 * into the summary/export list below it. Local-only (browser localStorage),
 * same pattern as useOverrides — this is a personal working list, not
 * written back to Supabase.
 */
export function useCalculatorSummary() {
  const [items, setItems] = useState<CalcSummaryItem[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) setItems(JSON.parse(saved));
    } catch {
      // ignore — start from an empty list if localStorage is unavailable
    }
  }, []);

  const persist = useCallback((next: CalcSummaryItem[]) => {
    setItems(next);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      // best-effort only
    }
  }, []);

  const addItem = useCallback(
    (item: Omit<CalcSummaryItem, "id" | "addedAt">) => {
      const withId: CalcSummaryItem = { ...item, id: newId(), addedAt: new Date().toISOString() };
      setItems((prev) => {
        const next = [...prev, withId];
        try {
          localStorage.setItem(LS_KEY, JSON.stringify(next));
        } catch {
          // best-effort only
        }
        return next;
      });
    },
    []
  );

  const removeItem = useCallback(
    (id: string) => {
      setItems((prev) => {
        const next = prev.filter((it) => it.id !== id);
        try {
          localStorage.setItem(LS_KEY, JSON.stringify(next));
        } catch {
          // best-effort only
        }
        return next;
      });
    },
    []
  );

  const clearAll = useCallback(() => persist([]), [persist]);

  return { items, addItem, removeItem, clearAll };
}
