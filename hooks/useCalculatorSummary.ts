"use client";

import { useState, useCallback, useEffect } from "react";
import type { CalcSummaryItem } from "@/lib/types";

/** Kunci penyimpanan lama (sebelum update-27) — dibersihkan supaya daftar lama tidak tertinggal di browser. */
const OLD_LS_KEY = "tn_ms_calc_summary";

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {
    // lanjut ke id manual di bawah
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Daftar part yang dicek di page Calculator. Hanya disimpan di memori halaman:
 * kosong lagi setiap halaman di-refresh / dibuka ulang (sama seperti filter).
 */
export function useCalculatorSummary() {
  const [items, setItems] = useState<CalcSummaryItem[]>([]);

  useEffect(() => {
    try {
      localStorage.removeItem(OLD_LS_KEY);
    } catch {
      // abaikan
    }
  }, []);

  const addItem = useCallback((item: Omit<CalcSummaryItem, "id" | "addedAt">) => {
    setItems((prev) => [...prev, { ...item, id: newId(), addedAt: new Date().toISOString() }]);
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  const clearAll = useCallback(() => setItems([]), []);

  return { items, addItem, removeItem, clearAll };
}
