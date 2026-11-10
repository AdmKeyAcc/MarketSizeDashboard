"use client";

import { EMPTY_UIO_FILTERS, filterUioUnits, uioFilterOptions, type UioFilterKey, type UioFilterState } from "@/lib/uioFilter";
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
  allowedProducts,
  custKey,
  getRealCustomers,
  resolveUioYears,
  uioByDimension,
  uioDetailRows,
  uioScopedUnits,
  marketSizeByYear,
  marketShareByYear,
  findPartsWithoutPrice,
  unitActiveIn
} from "@/lib/calculations";
import { MONTH_ORDER, type Customer, type DashboardData } from "@/lib/types";
import { applyReferences, kaRank } from "@/lib/references";
import { comparePlan } from "@/lib/period";
import { buildCustomerIndex, marketRowsFromFacts } from "@/lib/hierarchy";
import { useYearFacts } from "@/hooks/useYearFacts";

/** Branch & PSS di Master Customer sering kosong, padahal Data UIO punya kolom Branch dan Pss Name per unit.
 * Isi yang kosong dengan nilai terbanyak dari unit milik customer itu, supaya filter Branch / PSS di
 * seluruh dashboard ada isinya dan bekerja sampai ke perhitungan Market Share. */
/** Market Share hanya membandingkan Product yang punya Market Size (ada di Master Part).
 * Actual Product lain (mis. IKD, BKT, OIL, battery) tidak punya pasangan Market Size — kalau ikut
 * dijumlahkan, share jadi terlalu tinggi. Disaring sekali di sini supaya KPI, chart, tabel hierarki
 * dan Summary memakai angka yang sama. */
/**
 * Actual Sales yang dibandingkan dengan Market Size.
 *  - Kalau ringkasan Actual per part tersedia (actual_qty_year + kolom Rupiah, migration v23): Actual = penjualan
 *    HANYA Part Number yang ada di Master Part → cakupan part sama persis dengan Market Size.
 *    Customer Type tetap diambil dari laporan Actual per customer.
 *  - Kalau belum: Actual per customer × product, hanya product yang ada di Master Part (aturan lama).
 */
function comparableActual(
  data: DashboardData
): DashboardData & { actualExcluded: { products: string[]; amount: number }; actualScope: "part" | "product" } {
  const msProducts = new Set(data.parts.map((p) => canonicalProduct(p.product)));
  const partRows = (data.actualQtyYear || []).filter((r) => typeof r.amount === "number");
  if (partRows.length > 0 && msProducts.size > 0) {
    const kaOf = new Map<string, Map<string, number>>();
    let totalAll = 0;
    data.actualSalesYear.forEach((r) => {
      totalAll += r.amount || 0;
      if (!r.ka_type) return;
      const k = custKey(r.customer_group, r.customer_name);
      let m = kaOf.get(k);
      if (!m) kaOf.set(k, (m = new Map()));
      m.set(r.ka_type, (m.get(r.ka_type) || 0) + Math.abs(r.amount || 0));
    });
    const topKa = (k: string) => {
      const m = kaOf.get(k);
      return m && m.size > 0 ? Array.from(m.entries()).sort((x, y) => y[1] - x[1])[0][0] : null;
    };
    const rows: DashboardData["actualSalesYear"] = partRows.map((r) => ({
      year: r.year,
      ka_type: topKa(custKey(r.customer_group, r.customer_name)),
      customer_group: r.customer_group,
      customer_name: r.customer_name,
      product: r.product,
      amount: r.amount || 0,
      amount_by_month: Array.isArray(r.amount_by_month) && r.amount_by_month.length === 12 ? r.amount_by_month : null
    }));
    const kept = rows.reduce((t, r) => t + r.amount, 0);
    return { ...data, actualSalesYear: rows, actualExcluded: { products: [], amount: Math.max(0, totalAll - kept) }, actualScope: "part" };
  }
  if (msProducts.size === 0) return { ...data, actualExcluded: { products: [], amount: 0 }, actualScope: "product" };
  const kept: DashboardData["actualSalesYear"] = [];
  const excluded = new Set<string>();
  let amount = 0;
  data.actualSalesYear.forEach((r) => {
    const pk = canonicalProduct(r.product);
    if (msProducts.has(pk)) kept.push(r);
    else {
      excluded.add(pk || "(tanpa product)");
      amount += r.amount || 0;
    }
  });
  return { ...data, actualSalesYear: kept, actualExcluded: { products: Array.from(excluded).sort(), amount }, actualScope: "product" };
}

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
  // Kamus & pengaturan (alias product, Customer Type, angka default rumus) dari Supabase harus
  // terpasang SEBELUM semua perhitungan di bawah. Idempotent: tidak berbuat apa-apa kalau sama.
  applyReferences(rawData.references);
  const data = useMemo(() => comparableActual(enrichCustomersFromUio(rawData)), [rawData]);
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
  // ---- filter UIO (terpisah dari filter Market) ----
  const [uioFilters, setUioFiltersState] = useState<UioFilterState>(EMPTY_UIO_FILTERS);
  const setUioFilter = useCallback((key: UioFilterKey, value: string[]) => setUioFiltersState((prev) => ({ ...prev, [key]: value })), []);
  const resetUioFilters = useCallback(() => setUioFiltersState(EMPTY_UIO_FILTERS), []);

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
  const realCustomers = useMemo(() => getRealCustomers(data.customers), [data.customers]);


  // ---- dashboard charts: UIO per product / market size & share per tahun ----
  // UIO (chart UIO per Product & Detail UIO) punya filter sendiri — lihat bagian "filter UIO" di bawah.
  // Rumus lama (harga non kontrak untuk semua customer) — HANYA dipakai kalau belum ada Actual Sales tahunan
  // atau Master Part. Tidak lagi ditampilkan sebagai angka sementara saat mesin hitung utama berjalan,
  // karena hasilnya berbeda dan membuat scorecard terlihat berubah-ubah setiap refresh.
  const legacyMarketRows = useMemo(
    () =>
      data.actualSalesYear.length > 0 && data.parts.length > 0
        ? []
        : marketSizeByYear(
        data.parts,
        data.uioUnits,
        data.priceList,
        data.actualSales,
        data.actualSalesTx,
        filters,
        data.customers,
        data.actualSalesYear,
        { year: data.meta.actual_year_ytd_year ?? null, month: data.meta.actual_year_ytd_month ?? null }
      ),
    [data.parts, data.uioUnits, data.priceList, data.actualSales, data.actualSalesTx, data.actualSalesYear, data.meta, filters, data.customers]
  );

  // ---- satu mesin hitung untuk tabel hierarki, chart, dan KPI: Market Size per customer × Product × Model per tahun ----
  const custIndex = useMemo(
    () => buildCustomerIndex(realCustomers, data.uioUnits, data.actualSalesYear, data.priceList, data.actualQtyYear || []),
    [realCustomers, data.uioUnits, data.actualSalesYear, data.priceList, data.actualQtyYear]
  );

  // Customer Type per customer (dari Actual / Master Customer) untuk filter UIO.
  const custTypeMap = useMemo(() => {
    const m = new Map<string, string>();
    custIndex.forEach((c) => {
      if (c.ka && !c.ka.startsWith("(")) [c.key, ...c.aliasKeys].forEach((k) => m.set(k, c.ka));
    });
    return m;
  }, [custIndex]);
  const uioUnitsScoped = useMemo(() => filterUioUnits(data.uioUnits, uioFilters, custTypeMap), [data.uioUnits, uioFilters, custTypeMap]);
  const uioOptions = useMemo(() => uioFilterOptions(data.uioUnits, uioFilters, custTypeMap), [data.uioUnits, uioFilters, custTypeMap]);
  const uioByProductRows = useMemo(() => {
    const totals = new Map<string, number>();
    uioUnitsScoped.forEach((u) => {
      const k = canonicalProduct(u.product) || "Lainnya";
      totals.set(k, (totals.get(k) || 0) + 1);
    });
    return Array.from(totals.entries())
      .map(([label, uio]) => ({ label, uio }))
      .sort((a, b) => b.uio - a.uio);
  }, [uioUnitsScoped]);
  const factYears = useMemo(() => {
    const ys = new Set<number>();
    data.uioUnits.forEach((u) => {
      if (u.year !== null) ys.add(u.year);
    });
    data.actualSalesYear.forEach((r) => ys.add(r.year));
    return Array.from(ys).sort((a, b) => a - b);
  }, [data.uioUnits, data.actualSalesYear]);
  const { facts: yearFacts, progress: factsProgress } = useYearFacts(custIndex, data.parts, data.priceList, factYears, filters);

  // Satu rencana periode (bulan Market Size, bulan Actual, bisa dibandingkan?) untuk KPI, chart, hierarki & Summary.
  const plan = useMemo(
    () => comparePlan(data.actualSalesYear, filters, { year: data.meta.actual_year_ytd_year ?? null, month: data.meta.actual_year_ytd_month ?? null }),
    [data.actualSalesYear, filters, data.meta]
  );
  const marketSizeYearRows = useMemo(() => {
    const usesFacts = data.actualSalesYear.length > 0 && data.parts.length > 0;
    if (!usesFacts) return legacyMarketRows;
    // Mesin hitung utama belum selesai → kosong dulu (komponen menampilkan "Menghitung…"), bukan angka sementara.
    if (factsProgress !== null || yearFacts.size === 0) return [];
    const sel = filters.tahun.length > 0 ? new Set(filters.tahun.map((y) => parseInt(y, 10))) : null;
    const years = factYears.filter((y) => !sel || sel.has(y));
    return marketRowsFromFacts(custIndex, yearFacts, years, filters, plan);
  }, [legacyMarketRows, factsProgress, yearFacts, custIndex, factYears, filters, data.actualSalesYear, data.parts.length, plan]);
  const marketShareYearRows = useMemo(() => marketShareByYear(marketSizeYearRows), [marketSizeYearRows]);
  const partsWithoutPrice = useMemo(
    () => findPartsWithoutPrice(data.parts, data.priceList),
    [data.parts, data.priceList]
  );
  // ---- cascading filter option lists (no "Semua" sentinel anymore — an
  // empty selection in the checklist itself means "no restriction") ----
  // Ringkasan per customer untuk cascading filter: tahun UIO paling awal per product, dan tahun Actual per product.
  const cascadeInfo = useMemo(() => {
    type Info = { c: Customer; prodYears: Map<string, Set<number>>; actProd: Map<string, Set<number>> };
    const m = new Map<string, Info>();
    realCustomers.forEach((c) => {
      m.set(custKey(c.customer_group, c.customer_name), { c, prodYears: new Map(), actProd: new Map() });
    });
    data.uioUnits.forEach((u) => {
      const inf = m.get(custKey(u.customer_group, u.customer_name));
      if (!inf || u.year === null) return;
      const p = canonicalProduct(u.product);
      let st = inf.prodYears.get(p);
      if (!st) inf.prodYears.set(p, (st = new Set()));
      st.add(u.year);
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
      const prods = ps ?? Array.from(new Set([...inf.prodYears.keys(), ...inf.actProd.keys()]));
      return prods.some((p) => {
        const pc = canonicalProduct(p);
        const uy = inf.prodYears.get(pc);
        const act = inf.actProd.get(pc);
        const actAll = inf.actProd.get("");
        if (!ys) return !!uy || !!act;
        // Unit dihitung di tahun y kalau masih dalam umurnya (lihat unitActiveIn).
        return ys.some((y) => (!!uy && Array.from(uy).some((by) => unitActiveIn({ year: by }, y))) || !!act?.has(y) || (!ps && !!actAll?.has(y)));
      });
    };
    type Dim = "tahun" | "area" | "pss" | "customerGroup" | "customerName" | "tier" | "product";
    const pass = (inf: Info, ex: Dim): boolean => {
      const c = inf.c;
      if (ex !== "customerGroup" && filters.customerGroup.length > 0 && !up(filters.customerGroup).has((c.customer_group || "").trim().toUpperCase())) return false;
      if (ex !== "customerName" && filters.customerName.length > 0 && !up(filters.customerName).has((c.customer_name || "").trim().toUpperCase())) return false;
      if (ex !== "area" && filters.area.length > 0 && !up(filters.area).has((c.cabang || "").trim().toUpperCase())) return false;
      if (ex !== "pss" && filters.pss.length > 0 && !up(filters.pss).has((c.pss || "").trim().toUpperCase())) return false;
      if (ex !== "tier" && filters.tier.length > 0 && !up(filters.tier).has((c.tier || "").trim().toUpperCase())) return false;
      const ys = ex !== "tahun" && selYears.length > 0 ? selYears : null;
      const ps = ex !== "product" && selProducts.length > 0 ? selProducts : null;
      return hasDataFor(inf, ys, ps);
    };
    const pool = (ex: Dim) => cascadeInfo.filter((inf) => pass(inf, ex));

    const areaOpts = uniq(pool("area").map((i) => i.c.cabang))
      .filter((a) => !EXCLUDED_AREAS.includes(a.trim().toUpperCase()))
      .sort();
    const pssOpts = uniq(pool("pss").map((i) => i.c.pss)).sort();
    const groupOpts = uniq(pool("customerGroup").map((i) => i.c.customer_group)).sort();
    // uniq() wajib: nama customer yang sama bisa ada di lebih dari satu Customer Group.
    const customerNameOpts = uniq(pool("customerName").map((i) => i.c.customer_name as string)).sort();
    const tierOpts = uniq([
      ...pool("tier").map((i) => i.c.tier),
      ...data.actualSalesYear.map((r) => r.ka_type).filter(() => filters.customerGroup.length + filters.customerName.length + filters.area.length + filters.pss.length === 0 && selYears.length === 0 && selProducts.length === 0)
    ]).sort((a, b) => {
      return kaRank(a) - kaRank(b) || a.localeCompare(b);
    });

    // Tahun: hanya tahun yang punya data untuk customer/product yang sedang dipilih.
    const cascadeActive =
      filters.customerGroup.length + filters.customerName.length + filters.area.length + filters.pss.length + filters.tier.length + selProducts.length > 0;
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
          (maxSelYear === null || selYears.some((y) => unitActiveIn(u, y)))
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
    realCustomers,
    options,
    uioFilters,
    setUioFilter,
    resetUioFilters,
    uioOptions,
    uioByProductRows,
    uioUnitsScoped,
    partsWithoutPrice,
    marketSizeView,
    setMarketSizeView,
    marketSizeYearRows,
    marketShareYearRows,
    custIndex,
    factYears,
    yearFacts,
    factsProgress,
    plan,
    /** true selama Market Size per customer masih dihitung (scorecard & chart menampilkan "Menghitung…"). */
    marketComputing:
      data.actualSalesYear.length > 0 && data.parts.length > 0 && factYears.length > 0 && (factsProgress !== null || yearFacts.size === 0)
  };
}

export type UseDashboardState = ReturnType<typeof useDashboardState>;
