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
  custKey,
  getRealCustomers,
  resolveUioYears,
  uioByDimension,
  uioDetailRows,
  uioScopedUnits,
  marketSizeByYear,
  marketShareByYear,
  findPartsWithoutPrice
} from "@/lib/calculations";
import { CUSTOMER_TIER_OPTIONS, MONTH_ORDER, type Customer, type DashboardData } from "@/lib/types";
import { buildCustomerIndex, marketRowsFromFacts } from "@/lib/hierarchy";
import { useYearFacts } from "@/hooks/useYearFacts";
import { monthsShare } from "@/lib/workdays";

/** Branch & PSS di Master Customer sering kosong, padahal Data UIO punya kolom Branch dan Pss Name per unit.
 * Isi yang kosong dengan nilai terbanyak dari unit milik customer itu, supaya filter Branch / PSS di
 * seluruh dashboard ada isinya dan bekerja sampai ke perhitungan Market Share. */
function enrichCustomersFromUio(data: DashboardData): DashboardData {
  if (data.uioUnits.length === 0 || data.customers.length === 0) return data;
  const branch = new Map<string, Map<string, number>>();
  const pss = new Map<string, Map<string, number>>();
  const bump = (m: Map<string, Map<string, number>>, k: string, v: string) => {
    if (!v) return;
    let inner = m.get(k);
    if (!inner) m.set(k, (inner = new Map()));
    inner.set(v, (inner.get(v) || 0) + 1);
  };
  data.uioUnits.forEach((u) => {
    const k = custKey(u.customer_group, u.customer_name);
    bump(branch, k, (u.branch || "").trim());
    bump(pss, k, (u.pss_name || "").trim());
  });
  const top = (m: Map<string, number> | undefined) => {
    let best = "";
    let n = 0;
    m?.forEach((c, v) => {
      if (c > n || (c === n && v < best)) {
        best = v;
        n = c;
      }
    });
    return best || null;
  };
  let changed = false;
  const customers: Customer[] = data.customers.map((c) => {
    const needBranch = !(c.cabang || "").trim();
    const needPss = !(c.pss || "").trim();
    if (!needBranch && !needPss) return c;
    const k = custKey(c.customer_group, c.customer_name);
    const b = needBranch ? top(branch.get(k)) : null;
    const p = needPss ? top(pss.get(k)) : null;
    if (!b && !p) return c;
    changed = true;
    return { ...c, cabang: b ?? c.cabang, pss: p ?? c.pss };
  });
  return changed ? { ...data, customers } : data;
}

export function useDashboardState(initialData: DashboardData) {
  const [rawData, setData] = useState<DashboardData>(initialData);
  const data = useMemo(() => enrichCustomersFromUio(rawData), [rawData]);
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
    data.actualSalesYear.forEach((r) => ys.add(r.year));
    return { years: Array.from(ys).map(String), months: Array.from(ms) };
  }, [data.actualSalesTx, data.actualSales, data.actualSalesYear]);
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
  const uioDetail = useMemo(
    () => uioDetailRows(data.uioUnits, uioYears, filters, data.customers),
    [data.uioUnits, uioYears, filters, data.customers]
  );
  const uioUnitsScoped = useMemo(
    () => uioScopedUnits(data.uioUnits, uioYears, filters, data.customers),
    [data.uioUnits, uioYears, filters, data.customers]
  );
  const legacyMarketRows = useMemo(
    () =>
      marketSizeByYear(
        data.parts,
        data.assumptions,
        data.uioUnits,
        data.priceList,
        data.actualSales,
        data.actualSalesTx,
        filters,
        data.customers,
        data.actualSalesYear,
        { year: data.meta.actual_year_ytd_year ?? null, month: data.meta.actual_year_ytd_month ?? null }
      ),
    [data.parts, data.assumptions, data.uioUnits, data.priceList, data.actualSales, data.actualSalesTx, data.actualSalesYear, data.meta, filters, data.customers]
  );

  // ---- satu mesin hitung untuk tabel hierarki, chart, dan KPI: Market Size per customer × Product × Model per tahun ----
  const custIndex = useMemo(
    () => buildCustomerIndex(realCustomers, data.uioUnits, data.actualSalesYear, data.priceList),
    [realCustomers, data.uioUnits, data.actualSalesYear, data.priceList]
  );
  const factYears = useMemo(() => {
    const ys = new Set<number>();
    data.uioUnits.forEach((u) => {
      if (u.year !== null) ys.add(u.year);
    });
    data.actualSalesYear.forEach((r) => ys.add(r.year));
    return Array.from(ys).sort((a, b) => a - b);
  }, [data.uioUnits, data.actualSalesYear]);
  const { facts: yearFacts, progress: factsProgress } = useYearFacts(custIndex, data.parts, data.assumptions, data.priceList, factYears, filters);

  const marketSizeYearRows = useMemo(() => {
    const ready = factsProgress === null && yearFacts.size > 0 && data.actualSalesYear.length > 0 && data.parts.length > 0;
    if (!ready) return legacyMarketRows;
    const ytdYear = data.meta.actual_year_ytd_year ?? null;
    const ytdMonth = data.meta.actual_year_ytd_month ?? null;
    const ytdIdx = ytdMonth ? (MONTH_ORDER as readonly string[]).indexOf(ytdMonth) : -1;
    const isYtd = (y: number) => y === ytdYear && ytdIdx >= 0 && ytdIdx < 11;
    const actualHasProduct = data.actualSalesYear.some((r) => !!r.product);
    const actualComparable =
      filters.bulan.length === 0 && (filters.product.length === 0 || actualHasProduct) && filters.modelUnit.length === 0 && filters.partNumber.length === 0 && filters.partName.length === 0;
    const sel = filters.tahun.length > 0 ? new Set(filters.tahun.map((y) => parseInt(y, 10))) : null;
    const years = factYears.filter((y) => !sel || sel.has(y));
    const rows = marketRowsFromFacts(custIndex, yearFacts, years, filters, {
      factorOf: (y) => (filters.bulan.length > 0 ? monthsShare(filters.bulan) : isYtd(y) ? monthsShare(MONTH_ORDER.slice(0, ytdIdx + 1)) : 1),
      monthsOf: (y) => (filters.bulan.length > 0 ? filters.bulan.length : isYtd(y) ? ytdIdx + 1 : 12),
      actualComparable
    });
    return rows.length > 0 ? rows : legacyMarketRows;
  }, [legacyMarketRows, factsProgress, yearFacts, custIndex, factYears, filters, data.actualSalesYear, data.parts.length, data.meta]);
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
    const tierOpts = uniq([...realCustomers.map((c) => c.tier), ...data.actualSalesYear.map((r) => r.ka_type)]).sort((a, b) => {
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
  }, [actualPeriods, realCustomers, data.parts, data.uioUnits, data.actualSalesYear, filters]);

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
    uioDetail,
    uioUnitsScoped,
    partsWithoutPrice,
    marketSizeView,
    setMarketSizeView,
    marketSizeYearRows,
    marketShareYearRows,
    custIndex,
    factYears,
    yearFacts,
    factsProgress
  };
}

export type UseDashboardState = ReturnType<typeof useDashboardState>;
