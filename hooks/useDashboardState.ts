"use client";

import { useState, useCallback, useMemo } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fetchDashboardDataWithClient } from "@/lib/fetchDashboardDataShared";
import {
  EMPTY_FILTERS,
  EXCLUDED_AREAS,
  type FilterState,
  uniq,
  canonicalProduct,
  monthIndex,
  buildModelLookup,
  buildDetailRows,
  allowedProducts,
  getRealCustomers,
  resolveUioYears,
  uioByDimension,
  marketSizeByYear,
  marketShareByYear,
  findPartsWithoutPrice
} from "@/lib/calculations";
import { CUSTOMER_TIER_OPTIONS, MONTH_ORDER, type DashboardData } from "@/lib/types";

export function useDashboardState(initialData: DashboardData) {
  const [data, setData] = useState<DashboardData>(initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFiltersState] = useState<FilterState>(EMPTY_FILTERS);
  const [marketSizeView, setMarketSizeView] = useState<"amount" | "quantity">("amount");

  const refetch = useCallback(async () => {
    setRefreshing(true);
    try {
      const fresh = await fetchDashboardDataWithClient(supabaseBrowser);
      setData(fresh);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const setFilter = useCallback(<K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setFiltersState((prev) => ({ ...prev, [key]: value }));
  }, []);
  const resetFilters = useCallback(() => setFiltersState(EMPTY_FILTERS), []);

  // Tahun & bulan yang punya data Actual Sales (dipakai untuk pilihan filter).
  const actualPeriods = useMemo(() => {
    const ys = new Set<number>();
    const ms = new Set<string>();
    if (data.actualSalesTx.length > 0) {
      data.actualSalesTx.forEach((r) => {
        ys.add(r.year);
        ms.add(r.month);
      });
    } else {
      data.actualSales.forEach((r) => {
        ys.add(r.year);
        ms.add(r.month);
      });
    }
    return { years: Array.from(ys).map(String), months: Array.from(ms) };
  }, [data.actualSalesTx, data.actualSales]);
  const modelLookup = useMemo(() => buildModelLookup(data.uio), [data.uio]);
  const realCustomers = useMemo(() => getRealCustomers(data.customers), [data.customers]);

  const detailRows = useMemo(
    () => buildDetailRows(data.parts, data.assumptions, data.uioUnits, data.priceList, data.customers, data.actualSalesTx, filters),
    [data.parts, data.assumptions, data.uioUnits, data.priceList, data.customers, data.actualSalesTx, filters]
  );

  // ---- dashboard charts: UIO per product / market size & share per tahun ----
  const uioYears = useMemo(() => resolveUioYears(filters, data.uioUnits), [filters, data.uioUnits]);
  const uioByProductRows = useMemo(
    () => uioByDimension(data.uioUnits, uioYears, "product", filters, data.customers),
    [data.uioUnits, uioYears, filters, data.customers]
  );
  const marketSizeYearRows = useMemo(
    () =>
      marketSizeByYear(
        data.parts,
        data.assumptions,
        data.uioUnits,
        data.priceList,
        data.actualSales,
        data.actualSalesTx,
        filters,
        data.customers
      ),
    [data.parts, data.assumptions, data.uioUnits, data.priceList, data.actualSales, data.actualSalesTx, filters, data.customers]
  );
  const marketShareYearRows = useMemo(() => marketShareByYear(marketSizeYearRows), [marketSizeYearRows]);
  const partsWithoutPrice = useMemo(
    () => findPartsWithoutPrice(data.parts, data.priceList),
    [data.parts, data.priceList]
  );
  // ---- cascading filter option lists (no "Semua" sentinel anymore — an
  // empty selection in the checklist itself means "no restriction") ----
  const options = useMemo(() => {
    const years = actualPeriods.years;
    const uioYearsAll = uniq(data.uioUnits.map((u) => u.year)).filter((y): y is number => y !== null).sort((a, b) => a - b);
    const allYears = uniq([...years, ...uioYearsAll.map(String)]).sort();
    const monthOpts = actualPeriods.months.slice().sort((a, b) => monthIndex(a) - monthIndex(b));
    const areaOpts = uniq(realCustomers.map((c) => c.cabang))
      .filter((a) => !EXCLUDED_AREAS.includes(a.trim().toUpperCase()))
      .sort();
    // Sector customer — satu customer bisa punya lebih dari satu, jadi
    // di-flatten dulu sebelum di-uniq.
    const sectorOpts = uniq(realCustomers.flatMap((c) => c.customer_sector || [])).sort();
    const pssOpts = uniq(realCustomers.map((c) => c.pss)).sort();
    const groupOpts = uniq(realCustomers.map((c) => c.customer_group)).sort();
    const tierOpts = uniq(realCustomers.map((c) => c.tier)).sort((a, b) => {
      const ia = CUSTOMER_TIER_OPTIONS.indexOf(a as (typeof CUSTOMER_TIER_OPTIONS)[number]);
      const ib = CUSTOMER_TIER_OPTIONS.indexOf(b as (typeof CUSTOMER_TIER_OPTIONS)[number]);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

    let custPool = realCustomers;
    if (filters.customerGroup.length > 0) custPool = custPool.filter((c) => filters.customerGroup.includes(c.customer_group || ""));
    if (filters.area.length > 0) custPool = custPool.filter((c) => filters.area.includes(c.cabang || ""));
    if (filters.sector.length > 0)
      custPool = custPool.filter((c) => (c.customer_sector || []).some((s) => filters.sector.includes(s)));
    if (filters.tier.length > 0) custPool = custPool.filter((c) => filters.tier.includes(c.tier || ""));
    // uniq() is required here: the same Customer Name can legitimately exist
    // under more than one Customer Group (the DB's natural key is the
    // group+name pair, not the name alone), so without deduping this list
    // can contain the same name twice — which then breaks React's list
    // rendering (duplicate option keys).
    const customerNameOpts = uniq(custPool.map((c) => c.customer_name as string)).sort();

    const allowed = allowedProducts(filters);
    // Product & Model Unit diambil dari data part DAN dari Data UIO (populasi
    // unit) — kalau cuma dari part, model yang hanya ada di Data UIO tidak
    // pernah muncul di filter.
    let prods = uniq([...data.parts.map((p) => p.product), ...data.uioUnits.map((u) => canonicalProduct(u.product))]).sort();
    if (allowed) prods = prods.filter((p) => allowed.includes(p));

    let modelPool = data.parts;
    if (allowed) modelPool = modelPool.filter((p) => allowed.includes(p.product));
    if (filters.product.length > 0) modelPool = modelPool.filter((p) => filters.product.includes(p.product));
    const unitModels = data.uioUnits
      .filter(
        (u) =>
          filters.product.length === 0 ||
          filters.product.includes(canonicalProduct(u.product)) ||
          filters.product.includes(u.product || "")
      )
      .map((u) => u.model);
    const modelOpts = uniq([...modelPool.map((p) => p.model), ...unitModels]).sort();

    let partPool = modelPool;
    if (filters.modelUnit.length > 0) partPool = partPool.filter((p) => filters.modelUnit.includes(p.model));
    const partNumberOpts = uniq(partPool.map((p) => p.part_number)).sort();
    const partNameOpts = uniq(partPool.map((p) => p.part_name)).sort();

    return {
      tahun: allYears.length ? allYears : ["2026"],
      bulan: monthOpts.length ? monthOpts : (MONTH_ORDER as unknown as string[]),
      area: areaOpts,
      sector: sectorOpts,
      pss: pssOpts,
      customerGroup: groupOpts,
      customerName: customerNameOpts,
      tier: tierOpts,
      product: prods,
      modelUnit: modelOpts,
      partNumber: partNumberOpts,
      partName: partNameOpts
    };
  }, [actualPeriods, realCustomers, data.parts, data.uioUnits, filters]);

  return {
    data,
    setData,
    refetch,
    refreshing,
    filters,
    setFilter,
    resetFilters,
    modelLookup,
    realCustomers,
    detailRows,
    options,
    uioYears,
    uioByProductRows,
    partsWithoutPrice,
    marketSizeView,
    setMarketSizeView,
    marketSizeYearRows,
    marketShareYearRows
  };
}

export type UseDashboardState = ReturnType<typeof useDashboardState>;
