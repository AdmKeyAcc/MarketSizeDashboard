"use client";

import { useState, useCallback, useMemo } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fetchDashboardDataWithClient } from "@/lib/fetchDashboardDataShared";
import {
  EMPTY_FILTERS,
  DEFAULT_AREA,
  type FilterState,
  uniq,
  monthIndex,
  buildMonthly,
  buildModelLookup,
  buildDetailRows,
  aggregatedMonthly,
  monthsInScope,
  allowedProducts,
  getRealCustomers,
  isScalingActive,
  resolveUioYears,
  uioByDimension,
  type UioDimension,
  marketSizeByYear,
  marketShareByYear,
  findPartsWithoutPrice,
  actualSalesByMonth
} from "@/lib/calculations";
import { CUSTOMER_TIER_OPTIONS, MONTH_ORDER, type DashboardData } from "@/lib/types";

function initialFilters(d: DashboardData): FilterState {
  const hasDefaultArea = d.customers.some((c) => c.customer_name && c.cabang === DEFAULT_AREA);
  return hasDefaultArea ? { ...EMPTY_FILTERS, area: [DEFAULT_AREA] } : EMPTY_FILTERS;
}

export function useDashboardState(initialData: DashboardData) {
  const [data, setData] = useState<DashboardData>(initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFiltersState] = useState<FilterState>(() => initialFilters(initialData));
  const [uioDimension, setUioDimension] = useState<UioDimension>("product");
  const [marketSizeView, setMarketSizeView] = useState<"tahun" | "bulan">("tahun");

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
  const resetFilters = useCallback(() => setFiltersState(initialFilters(data)), [data]);

  const monthly = useMemo(() => buildMonthly(data.parts, data.actualSales), [data.parts, data.actualSales]);
  const modelLookup = useMemo(() => buildModelLookup(data.uio), [data.uio]);
  const realCustomers = useMemo(() => getRealCustomers(data.customers), [data.customers]);

  const detailRows = useMemo(
    () => buildDetailRows(data.parts, data.assumptions, data.uioUnits, data.priceList, data.customers, filters),
    [data.parts, data.assumptions, data.uioUnits, data.priceList, data.customers, filters]
  );
  const monthlyAgg = useMemo(() => aggregatedMonthly(monthly, data.customers, filters), [monthly, data.customers, filters]);
  const scaling = useMemo(() => isScalingActive(data.customers, filters), [data.customers, filters]);
  const months = useMemo(() => monthsInScope(monthly, filters), [monthly, filters]);

  // ---- dashboard charts: UIO per product / market size & share per tahun ----
  const uioYears = useMemo(() => resolveUioYears(filters, data.uioUnits), [filters, data.uioUnits]);
  const uioByProductRows = useMemo(
    () => uioByDimension(data.uioUnits, uioYears, uioDimension, filters, data.customers),
    [data.uioUnits, uioYears, uioDimension, filters, data.customers]
  );
  const marketSizeYearRows = useMemo(
    () => marketSizeByYear(data.parts, data.assumptions, data.uioUnits, data.priceList, data.actualSales, filters, data.customers),
    [data.parts, data.assumptions, data.uioUnits, data.priceList, data.actualSales, filters, data.customers]
  );
  const marketShareYearRows = useMemo(() => marketShareByYear(marketSizeYearRows), [marketSizeYearRows]);
  const partsWithoutPrice = useMemo(
    () => findPartsWithoutPrice(data.parts, data.priceList),
    [data.parts, data.priceList]
  );
  // Actual Sales per bulan hanya masuk akal kalau pengguna sudah mempersempit
  // ke SATU tahun (kalau belum/lebih dari satu, ambigu bulan dari tahun yang
  // mana) — Market Size tidak punya versi bulanan sama sekali (lihat
  // actualSalesByMonth di lib/calculations.ts).
  const singleYear = filters.tahun.length === 1 ? parseInt(filters.tahun[0], 10) : null;
  const actualSalesMonthRows = useMemo(
    () => (singleYear !== null && Number.isFinite(singleYear) ? actualSalesByMonth(data.actualSales, singleYear, filters) : []),
    [data.actualSales, singleYear, filters]
  );

  // ---- cascading filter option lists (no "Semua" sentinel anymore — an
  // empty selection in the checklist itself means "no restriction") ----
  const options = useMemo(() => {
    const years = uniq(monthly.map((r) => String(r.year))).sort();
    const uioYearsAll = uniq(data.uioUnits.map((u) => u.year)).filter((y): y is number => y !== null).sort((a, b) => a - b);
    const allYears = uniq([...years, ...uioYearsAll.map(String)]).sort();
    const monthOpts = uniq(monthly.map((r) => r.month)).sort((a, b) => monthIndex(a) - monthIndex(b));
    const areaOpts = uniq(realCustomers.map((c) => c.cabang)).sort();
    // Business Area = kode Sales Office (SOff.) customer — satu customer
    // bisa punya lebih dari satu, jadi di-flatten dulu sebelum di-uniq.
    const businessAreaOpts = uniq(realCustomers.flatMap((c) => c.business_area || [])).sort();
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
    if (filters.businessArea.length > 0)
      custPool = custPool.filter((c) => (c.business_area || []).some((ba) => filters.businessArea.includes(ba)));
    if (filters.tier.length > 0) custPool = custPool.filter((c) => filters.tier.includes(c.tier || ""));
    // uniq() is required here: the same Customer Name can legitimately exist
    // under more than one Customer Group (the DB's natural key is the
    // group+name pair, not the name alone), so without deduping this list
    // can contain the same name twice — which then breaks React's list
    // rendering (duplicate option keys).
    const customerNameOpts = uniq(custPool.map((c) => c.customer_name as string)).sort();

    const allowed = allowedProducts(filters);
    let prods = uniq(data.parts.map((p) => p.product)).sort();
    if (allowed) prods = prods.filter((p) => allowed.includes(p));

    let modelPool = data.parts;
    if (allowed) modelPool = modelPool.filter((p) => allowed.includes(p.product));
    if (filters.product.length > 0) modelPool = modelPool.filter((p) => filters.product.includes(p.product));
    const modelOpts = uniq(modelPool.map((p) => p.model)).sort();

    let partPool = modelPool;
    if (filters.modelUnit.length > 0) partPool = partPool.filter((p) => filters.modelUnit.includes(p.model));
    const partNumberOpts = uniq(partPool.map((p) => p.part_number)).sort();
    const partNameOpts = uniq(partPool.map((p) => p.part_name)).sort();

    return {
      tahun: allYears.length ? allYears : ["2026"],
      bulan: monthOpts.length ? monthOpts : (MONTH_ORDER.slice(0, 9) as unknown as string[]),
      area: areaOpts,
      businessArea: businessAreaOpts,
      pss: pssOpts,
      customerGroup: groupOpts,
      customerName: customerNameOpts,
      tier: tierOpts,
      product: prods,
      modelUnit: modelOpts,
      partNumber: partNumberOpts,
      partName: partNameOpts
    };
  }, [monthly, realCustomers, data.parts, data.uioUnits, filters]);

  return {
    data,
    setData,
    refetch,
    refreshing,
    filters,
    setFilter,
    resetFilters,
    monthly,
    modelLookup,
    realCustomers,
    detailRows,
    monthlyAgg,
    scaling,
    months,
    options,
    uioYears,
    uioDimension,
    setUioDimension,
    uioByProductRows,
    partsWithoutPrice,
    marketSizeView,
    setMarketSizeView,
    actualSalesMonthRows,
    singleYear,
    marketSizeYearRows,
    marketShareYearRows
  };
}

export type UseDashboardState = ReturnType<typeof useDashboardState>;
