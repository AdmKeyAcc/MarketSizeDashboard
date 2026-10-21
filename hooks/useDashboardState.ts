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
  // Ringkasan per customer untuk cascading filter: tahun UIO paling awal per product, dan tahun Actual per product.
  const cascadeInfo = useMemo(() => {
    type Info = { c: Customer; prodMin: Map<string, number>; actProd: Map<string, Set<number>> };
    const m = new Map<string, Info>();
    realCustomers.forEach((c) => {
      m.set(custKey(c.customer_group, c.customer_name), { c, prodMin: new Map(), actProd: new Map() });
    });
    data.uioUnits.forEach((u) => {
      const inf = m.get(custKey(u.customer_group, u.customer_name));
      if (!inf || u.year === null) return;
      const p = canonicalProduct(u.product);
      const cur = inf.prodMin.get(p);
      if (cur === undefined || u.year < cur) inf.prodMin.set(p, u.year);
    });
    data.actualSalesYear.forEach((r) => {
      const inf = m.get(custKey(r.customer_group, r.customer_name));
      if (!inf) return;
      const p = r.product ? canonicalProduct(r.product) : "";
      let st = inf.actProd.get(p);
      if (!st) inf.actProd.set(p, (st = new Set()));
      st.add(r.year);
    });
    return Array.from(m.values());
  }, [realCustomers, data.uioUnits, data.actualSalesYear]);

  // ---- cascading filter option lists: setiap pilihan hanya menampilkan nilai yang MASIH punya data
  // dengan filter lain yang sedang aktif (supaya tidak bisa memilih kombinasi yang pasti kosong).
  const options = useMemo(() => {
    const years = actualPeriods.years;
    const uioYearsAll = uniq(data.uioUnits.map((u) => u.year)).filter((y): y is number => y !== null).sort((a, b) => a - b);
    const allYears = uniq([...years, ...uioYearsAll.map(String)]).sort();
    const monthOpts = actualPeriods.months.slice().sort((a, b) => monthIndex(a) - monthIndex(b));

    type Info = (typeof cascadeInfo)[number];
    const up = (a: string[]) => new Set(a.map((x) => x.trim().toUpperCase()));
    const selYears = filters.tahun.map((y) => parseInt(y, 10)).filter((n) => Number.isFinite(n));
    const selProducts = filters.product;
    const hasDataFor = (inf: Info, ys: number[] | null, ps: string[] | null) => {
      if (!ys && !ps) return true;
      const prods = ps ?? Array.from(new Set([...inf.prodMin.keys(), ...inf.actProd.keys()]));
      return prods.some((p) => {
        const pc = canonicalProduct(p);
        const mn = inf.prodMin.get(pc);
        const act = inf.actProd.get(pc);
        const actAll = inf.actProd.get("");
        if (!ys) return mn !== undefined || !!act;
        return ys.some((y) => (mn !== undefined && mn <= y) || !!act?.has(y) || (!ps && !!actAll?.has(y)));
      });
    };
    type Dim = "tahun" | "area" | "sector" | "pss" | "customerGroup" | "customerName" | "tier" | "product";
    const pass = (inf: Info, ex: Dim): boolean => {
      const c = inf.c;
      if (ex !== "customerGroup" && filters.customerGroup.length > 0 && !up(filters.customerGroup).has((c.customer_group || "").trim().toUpperCase())) return false;
      if (ex !== "customerName" && filters.customerName.length > 0 && !up(filters.customerName).has((c.customer_name || "").trim().toUpperCase())) return false;
      if (ex !== "area" && filters.area.length > 0 && !up(filters.area).has((c.cabang || "").trim().toUpperCase())) return false;
      if (ex !== "pss" && filters.pss.length > 0 && !up(filters.pss).has((c.pss || "").trim().toUpperCase())) return false;
      if (ex !== "tier" && filters.tier.length > 0 && !up(filters.tier).has((c.tier || "").trim().toUpperCase())) return false;
      if (ex !== "sector" && filters.sector.length > 0 && !(c.customer_sector || []).some((x) => up(filters.sector).has(x.trim().toUpperCase()))) return false;
      const ys = ex !== "tahun" && selYears.length > 0 ? selYears : null;
      const ps = ex !== "product" && selProducts.length > 0 ? selProducts : null;
      return hasDataFor(inf, ys, ps);
    };
    const pool = (ex: Dim) => cascadeInfo.filter((inf) => pass(inf, ex));

    const areaOpts = uniq(pool("area").map((i) => i.c.cabang))
      .filter((a) => !EXCLUDED_AREAS.includes(a.trim().toUpperCase()))
      .sort();
    const sectorOpts = uniq(pool("sector").flatMap((i) => i.c.customer_sector || [])).sort();
    const pssOpts = uniq(pool("pss").map((i) => i.c.pss)).sort();
    const groupOpts = uniq(pool("customerGroup").map((i) => i.c.customer_group)).sort();
    // uniq() wajib: nama customer yang sama bisa ada di lebih dari satu Customer Group.
    const customerNameOpts = uniq(pool("customerName").map((i) => i.c.customer_name as string)).sort();
    const tierOpts = uniq([
      ...pool("tier").map((i) => i.c.tier),
      ...data.actualSalesYear.map((r) => r.ka_type).filter(() => filters.customerGroup.length + filters.customerName.length + filters.area.length + filters.pss.length + filters.sector.length === 0 && selYears.length === 0 && selProducts.length === 0)
    ]).sort((a, b) => {
      const ia = CUSTOMER_TIER_OPTIONS.indexOf(a as (typeof CUSTOMER_TIER_OPTIONS)[number]);
      const ib = CUSTOMER_TIER_OPTIONS.indexOf(b as (typeof CUSTOMER_TIER_OPTIONS)[number]);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

    // Tahun: hanya tahun yang punya data untuk customer/product yang sedang dipilih.
    const cascadeActive =
      filters.customerGroup.length + filters.customerName.length + filters.area.length + filters.pss.length + filters.sector.length + filters.tier.length + selProducts.length > 0;
    const yearPool = pool("tahun");
    const yearOpts = cascadeActive
      ? allYears.filter((y) => yearPool.some((inf) => hasDataFor(inf, [parseInt(y, 10)], selProducts.length > 0 ? selProducts : null)))
      : allYears;

    const allowed = allowedProducts(filters);
    let prods = uniq([...data.parts.map((p) => p.product), ...data.uioUnits.map((u) => canonicalProduct(u.product))]).sort();
    if (allowed) prods = prods.filter((p) => allowed.includes(p));
    if (cascadeActive || selYears.length > 0) {
      const pp = pool("product");
      prods = prods.filter((p) => pp.some((inf) => hasDataFor(inf, selYears.length > 0 ? selYears : null, [p])));
    }

    let modelPool = data.parts;
    if (allowed) modelPool = modelPool.filter((p) => allowed.includes(p.product));
    if (filters.product.length > 0) modelPool = modelPool.filter((p) => filters.product.includes(p.product));
    const maxSelYear = selYears.length > 0 ? Math.max(...selYears) : null;
    const okKeys = cascadeActive || selYears.length > 0 ? new Set(pool("product").map((i) => custKey(i.c.customer_group, i.c.customer_name))) : null;
    const unitModels = data.uioUnits
      .filter(
        (u) =>
          (filters.product.length === 0 || filters.product.includes(canonicalProduct(u.product)) || filters.product.includes(u.product || "")) &&
          (!okKeys || okKeys.has(custKey(u.customer_group, u.customer_name))) &&
          (maxSelYear === null || (u.year !== null && u.year <= maxSelYear))
      )
      .map((u) => u.model);
    const modelOpts = okKeys ? uniq(unitModels).sort() : uniq([...modelPool.map((p) => p.model), ...unitModels]).sort();

    let partPool = modelPool;
    if (filters.modelUnit.length > 0) partPool = partPool.filter((p) => filters.modelUnit.includes(p.model));
    const partNumberOpts = uniq(partPool.map((p) => p.part_number)).sort();
    const partNameOpts = uniq(partPool.map((p) => p.part_name)).sort();

    return {
      tahun: yearOpts.length ? yearOpts : allYears.length ? allYears : ["2026"],
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
  }, [actualPeriods, cascadeInfo, data.parts, data.uioUnits, data.actualSalesYear, filters]);

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
