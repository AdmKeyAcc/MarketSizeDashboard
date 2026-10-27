"use client";

import { useEffect, useState } from "react";
import type { FilterState } from "@/lib/calculations";
import { computeCustomerFacts, makeFactDeps, type CustInfo, type Fact } from "@/lib/hierarchy";
import type { Part, PriceListEntry } from "@/lib/types";

/** Market Size per customer × Product × Model untuk beberapa tahun sekaligus (satu mesin hitung untuk tabel hierarki, chart, dan KPI).
 * Dihitung bertahap supaya halaman tetap responsif. Hanya filter Product / Model / Part yang memengaruhi fakta;
 * filter customer (Branch, PSS, KA Type, Group, Customer) diterapkan saat fakta dijumlahkan. */
export function useYearFacts(
  custs: CustInfo[],
  parts: Part[],
  priceList: PriceListEntry[],
  years: number[],
  filters: FilterState
) {
  const [facts, setFacts] = useState<Map<number, Map<string, Fact[]>>>(new Map());
  const [progress, setProgress] = useState<number | null>(null);
  const yearsKey = years.join(",");

  useEffect(() => {
    if (years.length === 0 || parts.length === 0) {
      setFacts(new Map());
      setProgress(null);
      return;
    }
    const base = makeFactDeps(parts, priceList, years[0], filters);
    const depsByYear = years.map((y) => ({ year: y, deps: { ...base, year: y } }));
    const withUnits = custs.filter((c) => c.units.length > 0);
    const out = new Map<number, Map<string, Fact[]>>();
    years.forEach((y) => out.set(y, new Map()));
    let i = 0;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    setProgress(0);
    const step = () => {
      if (cancelled) return;
      const t0 = performance.now();
      while (i < withUnits.length && performance.now() - t0 < 12) {
        const c = withUnits[i++];
        depsByYear.forEach(({ year, deps }) => out.get(year)!.set(c.key, computeCustomerFacts(c, deps)));
      }
      if (i < withUnits.length) {
        setProgress(i / withUnits.length);
        timer = setTimeout(step, 0);
      } else {
        setFacts(out);
        setProgress(null);
      }
    };
    timer = setTimeout(step, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [custs, parts, priceList, yearsKey, filters.product, filters.modelUnit, filters.partNumber, filters.partName]);

  return { facts, progress };
}
