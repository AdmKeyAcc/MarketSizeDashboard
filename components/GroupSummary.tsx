"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { UseDashboardState } from "@/hooks/useDashboardState";
import {
  EMPTY_FILTERS,
  aggregateGroup,
  buildDetailRows,
  canonicalProduct,
  custKey,
  fmtIDRFull,
  fmtInt,
  fmtPct,
  prepareDetailCtx,
  resolveUioYears,
  uniq,
  type GroupRow
} from "@/lib/calculations";
import { MultiSelectField } from "@/components/FilterBar";
import { exportSummaryTableToExcel } from "@/lib/exportDetail";
import { comparePlan, periodOf, sumPeriod } from "@/lib/period";
import { type UioUnit } from "@/lib/types";
import { kaRank } from "@/lib/references";

const PAGE_SIZE = 20;
const PRICE_CONTRACT = "Contract (SCPL)";
const PRICE_NON = "Non Contract";

/** Satu baris tabel = satu Customer Group; tombol + membuka baris per Customer di bawahnya. */
type Row = GroupRow & {
  id: string; grp: string; cname: string; branch: string; pss: string; katype: string; pkind: string;
  /** Product / Model yang ada di baris ini (Market Size terbesar dulu) — mengikuti filter Product / Model unit. */
  product: string; model: string;
  kaList: string[]; allNames: string;
};
type RowM = Row & { qty_period: number; share_den: number };
type SortKey = keyof RowM;
type ColDef = { key: SortKey; label: string; kind: "text" | "num" | "computed"; width?: number };

const METRIC_COLS: ColDef[] = [
  { key: "customers", label: "Customer", kind: "num", width: 12 },
  { key: "uio", label: "UIO (unit)", kind: "num", width: 12 },
  { key: "qty_market_size", label: "Qty Market Size", kind: "computed", width: 16 },
  { key: "qty_period", label: "Qty Market Size (period)", kind: "computed", width: 20 },
  { key: "amount_market_size", label: "Market Size (Rp)", kind: "computed", width: 20 },
  { key: "amount_period", label: "Market Size (period) (Rp)", kind: "computed", width: 24 },
  { key: "actual_sales", label: "Actual Sales (Rp)", kind: "num", width: 20 },
  { key: "market_share", label: "Market Share", kind: "computed", width: 14 }
];
const LABEL_COLS: ColDef[] = [
  { key: "grp", label: "Customer Group", kind: "text", width: 32 },
  { key: "katype", label: "KA Type", kind: "text", width: 24 },
  { key: "cname", label: "Customer Name", kind: "text", width: 36 },
  { key: "branch", label: "Branch", kind: "text", width: 18 },
  { key: "pss", label: "PSS", kind: "text", width: 22 },
  { key: "product", label: "Product", kind: "text", width: 22 },
  { key: "model", label: "Model unit", kind: "text", width: 26 },
  { key: "pkind", label: "Price Type", kind: "text", width: 16 }
];

const normGroup = (g: string | null | undefined) => (g || "").trim().toUpperCase();
const normText = (v: string | null | undefined) => (v || "").trim().toUpperCase();
/** Daftar nilai terbanyak dulu, dipotong supaya sel tabel tidak melebar. */
const topList = (m: Map<string, number>, max = 3): string => {
  const arr = Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (arr.length === 0) return "";
  const head = arr.slice(0, max).map(([k]) => k).join(", ");
  return arr.length > max ? `${head} +${arr.length - max}` : head;
};
const addCount = (m: Map<string, number>, k: string, n = 1) => {
  if (k) m.set(k, (m.get(k) || 0) + n);
};
const tierRank = (t: string) => kaRank(t);
const byTier = (a: string, b: string) => tierRank(a) - tierRank(b) || a.localeCompare(b);

/** Tab Summary: dua box terpisah — (1) Filter, (2) Summary per Customer Group.
 * Filter di sini berdiri sendiri (tidak ikut filter di page Dashboard). */
export default function GroupSummary({ state }: { state: UseDashboardState }) {
  const { data } = state;
  const customers = state.realCustomers;

  // ---- state filter lokal ----
  const [fTahun, setFTahun] = useState<string[]>([]);
  const [fBulan, setFBulan] = useState<string[]>([]);
  const [fProduct, setFProduct] = useState<string[]>([]);
  const [fModel, setFModel] = useState<string[]>([]);
  const [cGroup, setCGroup] = useState<string[]>([]);
  const [cName, setCName] = useState<string[]>([]); // Customer Name
  const [cBranch, setCBranch] = useState<string[]>([]); // Branch (cabang Master Customer / branch Data UIO)
  const [cPss, setCPss] = useState<string[]>([]); // PSS
  const [cKa, setCKa] = useState<string[]>([]); // KA Type (KA NASIONAL, KA BRANCH GOLD, NKA, dst)
  const [cPrice, setCPrice] = useState<string[]>([]); // Contract (SCPL) / Non Contract

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [childCache, setChildCache] = useState<Map<string, Row[]>>(new Map());
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<SortKey>("amount_market_size");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  // ---- pilihan filter produk (saling mengikuti) ----
  const productOpts = useMemo(() => uniq(data.parts.map((p) => p.product)).sort(), [data.parts]);
  const modelOpts = useMemo(() => {
    const ps = new Set(fProduct);
    return uniq(data.parts.filter((p) => ps.size === 0 || ps.has(p.product)).map((p) => p.model)).sort();
  }, [data.parts, fProduct]);

  // ---- Daftar Customer: gabungan Master Customer, Data UIO, dan Actual Sales tahunan ----
  // Dibangun per Customer (Group + Nama). Tampilan per Customer Group dibuat dengan menggabungkan customer-nya.
  type GInfo = {
    key: string;
    name: string; // Customer Group
    custName: string; // Customer Name ("" kalau entitas gabungan group)
    custNames: Set<string>;
    tiers: Set<string>; // dari Master Customer
    kaAmount: Map<string, number>; // KA Type dari laporan Actual Sales -> total nilai
    actual: Map<number, number>; // tahun -> Rp
    actualM: Map<number, Float64Array>; // tahun -> Rp per bulan (kalau data Actual punya rincian bulan)
    actualProd: Map<number, Map<string, number>>; // tahun -> Product -> Rp (untuk kolom Product)
    units: UioUnit[];
    branches: Map<string, number>; // Branch -> bobot (Master Customer = 1000, tiap unit UIO = 1)
    pssNames: Map<string, number>;
  };
  const custEntities = useMemo(() => {
    const m = new Map<string, GInfo>();
    const get = (rawGroup: string, rawName: string) => {
      const group = (rawGroup || "").trim();
      const name = (rawName || "").trim();
      if (!group && !name) return null;
      const key = custKey(group || name, name);
      let g = m.get(key);
      if (!g) {
        g = {
          key,
          name: group || name,
          custName: name,
          custNames: new Set(name ? [normGroup(name)] : []),
          tiers: new Set(),
          kaAmount: new Map(),
          actual: new Map(),
          actualM: new Map(),
          actualProd: new Map(),
          units: [],
          branches: new Map(),
          pssNames: new Map()
        };
        m.set(key, g);
      }
      return g;
    };
    customers.forEach((c) => {
      const g = get(c.customer_group || "", c.customer_name || "");
      if (!g) return;
      if (c.tier) g.tiers.add(c.tier.trim().toUpperCase());
      addCount(g.branches, normText(c.cabang), 1000);
      addCount(g.pssNames, normText(c.pss), 1000);
    });
    data.uioUnits.forEach((u) => {
      const g = get(u.customer_group || "", u.customer_name || "");
      if (!g) return;
      g.units.push(u);
      addCount(g.branches, normText(u.branch));
      addCount(g.pssNames, normText(u.pss_name));
    });
    const prodSet = fProduct.length > 0 ? new Set(fProduct.map((p) => canonicalProduct(p))) : null;
    data.actualSalesYear.forEach((r) => {
      const g = get(r.customer_group, r.customer_name);
      if (!g) return;
      if (r.ka_type) g.kaAmount.set(r.ka_type, (g.kaAmount.get(r.ka_type) || 0) + r.amount);
      // Filter Product: Actual hanya dari Product yang dipilih.
      if (prodSet && !prodSet.has(canonicalProduct(r.product))) return;
      g.actual.set(r.year, (g.actual.get(r.year) || 0) + r.amount);
      let pm = g.actualProd.get(r.year);
      if (!pm) g.actualProd.set(r.year, (pm = new Map()));
      if (r.product) addCount(pm, canonicalProduct(r.product), r.amount);
      if (Array.isArray(r.amount_by_month) && r.amount_by_month.length === 12) {
        let arr = g.actualM.get(r.year);
        if (!arr) g.actualM.set(r.year, (arr = new Float64Array(12)));
        for (let i = 0; i < 12; i++) arr[i] += Number(r.amount_by_month[i]) || 0;
      }
    });
    return Array.from(m.values());
  }, [customers, data.uioUnits, data.actualSalesYear, fProduct]);

  // Customer Group yang punya harga kontrak (SCPL); simpan ejaan persis di Data Harga untuk pencarian harga.
  const contractNameByKey = useMemo(() => {
    const m = new Map<string, string>();
    data.priceList.forEach((p) => {
      if (p.price_type === "contract" && p.customer_group) m.set(normGroup(p.customer_group), p.customer_group);
    });
    return m;
  }, [data.priceList]);

  const kaOf = (g: GInfo): string[] => {
    const fromActual = Array.from(g.kaAmount.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k);
    if (fromActual.length > 0) return fromActual.sort(byTier);
    return Array.from(g.tiers).sort(byTier);
  };
  const priceKindOf = (g: GInfo) => (contractNameByKey.has(normGroup(g.name)) ? PRICE_CONTRACT : PRICE_NON);
  const branchOf = (g: GInfo) => Array.from(g.branches.keys());
  const pssOf = (g: GInfo) => Array.from(g.pssNames.keys());

  type CKey = "group" | "name" | "branch" | "pss" | "ka" | "price";
  const groupOpts = useMemo(() => {
    const sel = { group: new Set(cGroup), name: new Set(cName), branch: new Set(cBranch), pss: new Set(cPss), ka: new Set(cKa), price: new Set(cPrice) };
    const ok = (g: GInfo, skip: CKey) =>
      (skip === "group" || sel.group.size === 0 || sel.group.has(g.name)) &&
      (skip === "name" || sel.name.size === 0 || sel.name.has(g.custName)) &&
      (skip === "branch" || sel.branch.size === 0 || branchOf(g).some((b) => sel.branch.has(b))) &&
      (skip === "pss" || sel.pss.size === 0 || pssOf(g).some((p) => sel.pss.has(p))) &&
      (skip === "ka" || sel.ka.size === 0 || kaOf(g).some((k) => sel.ka.has(k))) &&
      (skip === "price" || sel.price.size === 0 || sel.price.has(priceKindOf(g)));
    return {
      group: uniq(custEntities.filter((g) => ok(g, "group")).map((g) => g.name)).sort(),
      name: uniq(custEntities.filter((g) => ok(g, "name")).map((g) => g.custName)).sort(),
      branch: uniq(custEntities.filter((g) => ok(g, "branch")).flatMap((g) => branchOf(g))).sort(),
      pss: uniq(custEntities.filter((g) => ok(g, "pss")).flatMap((g) => pssOf(g))).sort(),
      ka: uniq(custEntities.filter((g) => ok(g, "ka")).flatMap((g) => kaOf(g))).sort(byTier)
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [custEntities, contractNameByKey, cGroup, cName, cBranch, cPss, cKa, cPrice]);

  const tahunOpts = useMemo(() => {
    const ys = new Set<string>(state.options.tahun);
    data.actualSalesYear.forEach((r) => ys.add(String(r.year)));
    return Array.from(ys).sort();
  }, [state.options.tahun, data.actualSalesYear]);

  function changeProduct(next: string[]) {
    setFProduct(next);
    const ps = new Set(next);
    const avail = data.parts.filter((p) => ps.size === 0 || ps.has(p.product));
    const models = new Set(avail.map((p) => p.model));
    setFModel((m) => m.filter((x) => models.has(x)));
    setPage(1);
  }
  function changeModel(next: string[]) {
    setFModel(next);
    setPage(1);
  }
  const wrap = (set: (v: string[]) => void) => (v: string[]) => {
    set(v);
    setPage(1);
  };

  const hasFilter =
    fTahun.length + fBulan.length + fProduct.length + fModel.length + cGroup.length + cName.length + cBranch.length + cPss.length + cKa.length + cPrice.length > 0;

  function resetAll() {
    [setFTahun, setFBulan, setFProduct, setFModel, setCGroup, setCName, setCBranch, setCPss, setCKa, setCPrice].forEach((s) => s([]));
    setSearch("");
    setPage(1);
  }

  // Filter yang dipakai untuk menghitung: HANYA yang ada di box filter ini.
  const calcFilters = useMemo(
    () => ({ ...EMPTY_FILTERS, tahun: fTahun, bulan: fBulan, product: fProduct, modelUnit: fModel }),
    [fTahun, fBulan, fProduct, fModel]
  );
  const monthsSelected = fBulan.length > 0 ? new Set(fBulan).size : 12;

  // Tahun acuan: tahun terpilih (terbesar) atau tahun UIO terbaru; kalau belum ada UIO, tahun Actual Sales terbaru.
  const refYear = useMemo(() => {
    const ys = resolveUioYears(calcFilters, data.uioUnits);
    if (ys.length > 0) return Math.max(...ys);
    const ay = data.actualSalesYear.map((r) => r.year);
    return ay.length > 0 ? Math.max(...ay) : null;
  }, [calcFilters, data.uioUnits, data.actualSalesYear]);

  // Periode pembanding (aturan yang sama dengan Dashboard — lib/period.ts):
  //   Market Size periode = bulan di filter Bulan (kosong = setahun);
  //   penyebut share = bulan filter, atau Januari s/d bulan terakhir data Actual untuk tahun berjalan;
  //   Actual = total tahun, atau jumlah bulan terpilih dari rincian bulanan.
  const ytdMonth = data.meta.actual_year_ytd_month ?? null;
  const plan = useMemo(
    () =>
      comparePlan(data.actualSalesYear, { bulan: fBulan, product: fProduct, modelUnit: fModel, partNumber: [], partName: [] }, {
        year: data.meta.actual_year_ytd_year ?? null,
        month: ytdMonth
      }),
    [data.actualSalesYear, fBulan, fProduct, fModel, data.meta.actual_year_ytd_year, ytdMonth]
  );
  const selMonths = periodOf(0, fBulan, { year: null, month: null }).months;
  const denMonths = refYear !== null ? plan.monthsOf(refYear) : null;
  const actualMonths = refYear !== null ? plan.actualMonthsOf(refYear) : null;
  const isYtd = fBulan.length === 0 && denMonths !== null;
  const comparable = refYear !== null && plan.actualOkOf(refYear);
  const actualOf = (g: { actual: Map<number, number>; actualM: Map<number, Float64Array> }) =>
    refYear === null ? 0 : sumPeriod(g.actualM.get(refYear), actualMonths, g.actual.get(refYear) || 0);

  // ---- customer yang lolos filter; tiap Customer Group = gabungan customer yang lolos ----
  const passed = useMemo<GInfo[]>(() => {
    const sel = { group: new Set(cGroup), name: new Set(cName), branch: new Set(cBranch), pss: new Set(cPss), ka: new Set(cKa), price: new Set(cPrice) };
    return custEntities.filter(
      (g) =>
        (sel.group.size === 0 || sel.group.has(g.name)) &&
        (sel.name.size === 0 || sel.name.has(g.custName)) &&
        (sel.branch.size === 0 || branchOf(g).some((b) => sel.branch.has(b))) &&
        (sel.pss.size === 0 || pssOf(g).some((p) => sel.pss.has(p))) &&
        (sel.ka.size === 0 || kaOf(g).some((k) => sel.ka.has(k))) &&
        (sel.price.size === 0 || sel.price.has(priceKindOf(g)))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [custEntities, contractNameByKey, cGroup, cName, cBranch, cPss, cKa, cPrice]);

  const selected = useMemo<GInfo[]>(() => {
    const merged = new Map<string, GInfo>();
    passed.forEach((g) => {
      const key = normGroup(g.name);
      let t = merged.get(key);
      if (!t) {
        t = { key, name: g.name, custName: "", custNames: new Set(), tiers: new Set(), kaAmount: new Map(), actual: new Map(), actualM: new Map(), actualProd: new Map(), units: [], branches: new Map(), pssNames: new Map() };
        merged.set(key, t);
      }
      g.custNames.forEach((n) => t!.custNames.add(n));
      g.tiers.forEach((x) => t!.tiers.add(x));
      g.kaAmount.forEach((v, k) => t!.kaAmount.set(k, (t!.kaAmount.get(k) || 0) + v));
      g.actual.forEach((v, y) => t!.actual.set(y, (t!.actual.get(y) || 0) + v));
      g.actualM.forEach((arr, y) => {
        let a = t!.actualM.get(y);
        if (!a) t!.actualM.set(y, (a = new Float64Array(12)));
        for (let i = 0; i < 12; i++) a[i] += arr[i];
      });
      g.actualProd.forEach((pm, y) => {
        let a = t!.actualProd.get(y);
        if (!a) t!.actualProd.set(y, (a = new Map()));
        pm.forEach((v, k) => addCount(a!, k, v));
      });
      g.branches.forEach((v, k) => t!.branches.set(k, (t!.branches.get(k) || 0) + v));
      g.pssNames.forEach((v, k) => t!.pssNames.set(k, (t!.pssNames.get(k) || 0) + v));
      t.units.push(...g.units);
    });
    return Array.from(merged.values());
  }, [passed]);

  // Customer per Customer Group (untuk baris yang dibuka dengan tombol +).
  const customersByGroup = useMemo(() => {
    const m = new Map<string, GInfo[]>();
    passed.forEach((g) => {
      const k = normGroup(g.name);
      const arr = m.get(k);
      if (arr) arr.push(g);
      else m.set(k, [g]);
    });
    return m;
  }, [passed]);

  const detailCtx = useMemo(
    () => prepareDetailCtx(data.parts, data.uioUnits, data.priceList, [], calcFilters),
    [data.parts, data.uioUnits, data.priceList, calcFilters]
  );

  /** Hitung satu baris (Customer Group atau Customer). null = tidak ada unit & tidak ada Actual. */
  function computeRow(g: GInfo, isCustomer: boolean): Row | null {
    const actual = actualOf(g);
    if (g.units.length === 0 && actual === 0) return null;
    const nCust = g.custNames.size || 1;
    // Tanpa unit UIO tidak ada Market Size (tidak dihitung supaya tidak memakai perkiraan nasional).
    const list =
      g.units.length === 0
        ? []
        : buildDetailRows(data.parts, data.uioUnits, data.priceList, data.customers, [], calcFilters, new Set([g.key]), {
            units: g.units,
            tx: [],
            priceGroup: contractNameByKey.get(normGroup(g.name)) || g.name,
            ctx: detailCtx
          });
    const agg = aggregateGroup(g.name, nCust, list);
    // Product & Model di baris ini: dari Market Size (part yang dihitung), Product juga dari Actual tahun acuan.
    const prodW = new Map<string, number>();
    const modelW = new Map<string, number>();
    list.forEach((d) => {
      addCount(prodW, d.product, d.amount_market_size);
      addCount(modelW, d.model, d.amount_market_size);
    });
    if (refYear !== null) g.actualProd.get(refYear)?.forEach((v, k) => addCount(prodW, k, v));
    const ka = kaOf(g);
    const cname = isCustomer ? g.custName : nCust > 1 ? `${nCust.toLocaleString("id-ID")} customer` : Array.from(g.custNames)[0] || "";
    return {
      ...agg,
      actual_sales: actual,
      id: g.key,
      grp: g.name,
      cname,
      branch: topList(g.branches),
      pss: topList(g.pssNames),
      product: topList(prodW),
      model: topList(modelW),
      katype: ka.join(", "),
      kaList: ka,
      pkind: priceKindOf(g),
      allNames: isCustomer ? "" : Array.from(g.custNames).join(" | ").toLowerCase()
    };
  }

  // ---- hitung baris Customer Group (bertahap supaya halaman tetap responsif) ----
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const out: Row[] = [];
    let i = 0;
    setBusy(true);
    const step = () => {
      if (cancelled) return;
      const t0 = performance.now();
      while (i < selected.length && performance.now() - t0 < 12) {
        const r = computeRow(selected[i++], false);
        if (r) out.push(r);
      }
      if (i < selected.length) timers.push(setTimeout(step, 0));
      else {
        setRows(out);
        setBusy(false);
      }
    };
    timers.push(setTimeout(step, 0));
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, contractNameByKey, data, calcFilters, refYear, detailCtx]);

  // Hasil hitung customer disimpan per group; dibuang kalau filter / data berubah.
  useEffect(() => {
    setChildCache(new Map());
  }, [passed, contractNameByKey, data, calcFilters, refYear, detailCtx]);

  // Hitung customer dari group yang dibuka (satu group per putaran supaya tidak membekukan halaman).
  useEffect(() => {
    const next = Array.from(expanded).find((k) => !childCache.has(k));
    if (!next) return;
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      const list = (customersByGroup.get(next) || [])
        .map((g) => computeRow(g, true))
        .filter((r): r is Row => r !== null)
        .sort((a, b) => b.amount_market_size - a.amount_market_size || b.actual_sales - a.actual_sales);
      setChildCache((prev) => new Map(prev).set(next, list));
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, childCache, customersByGroup]);

  function toggleGroup(id: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const cols: ColDef[] = useMemo(() => [...LABEL_COLS, ...METRIC_COLS], []);
  const textKeys = useMemo(() => cols.filter((c) => c.kind === "text").map((c) => c.key), [cols]);

  // Market Size periode = jumlah kebutuhan bulan-bulan terpilih (setahun kalau filter Bulan kosong).
  // Market share = Actual ÷ Market Size periode yang sama (tahun berjalan: Januari s/d bulan terakhir data Actual).
  const withMetrics = (r: Row): RowM => {
    const den = sumPeriod(r.amount_months, denMonths, r.amount_market_size);
    return {
      ...r,
      qty_period: sumPeriod(r.qty_months, selMonths, r.qty_market_size),
      amount_period: sumPeriod(r.amount_months, selMonths, r.amount_market_size),
      share_den: den,
      market_share: comparable && den > 0 ? r.actual_sales / den : null
    };
  };
  const rowsM = useMemo<RowM[]>(
    () => rows.map(withMetrics),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, selMonths?.join(","), denMonths?.join(","), comparable]
  );

  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? rowsM.filter((r) => r.allNames.includes(q) || textKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(q))) : rowsM.slice();
    const key: SortKey = cols.some((c) => c.key === sortCol) ? sortCol : "amount_market_size";
    list.sort((a, b) => {
      const av = a[key] ?? 0;
      const bv = b[key] ?? 0;
      if (typeof av === "string" && typeof bv === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return list;
  }, [rowsM, search, sortCol, sortDir, cols, textKeys]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const pageRows = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const total = useMemo(() => {
    const sum = (f: (g: RowM) => number) => sorted.reduce((t, g) => t + f(g), 0);
    const den = sum((g) => g.share_den);
    return {
      customers: sum((g) => g.customers),
      uio: sum((g) => g.uio),
      qty_market_size: sum((g) => g.qty_market_size),
      qty_period: sum((g) => g.qty_period),
      amount_market_size: sum((g) => g.amount_market_size),
      amount_period: sum((g) => g.amount_period),
      actual_sales: sum((g) => g.actual_sales),
      market_share: comparable && den > 0 ? sum((g) => g.actual_sales) / den : null
    } as Record<string, number | null>;
  }, [sorted, comparable]);

  function onSort(key: SortKey) {
    if (sortCol === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(key);
      setSortDir("desc");
    }
    setPage(1);
  }

  function filterNote(): string {
    const parts: string[] = [];
    const add = (label: string, a: string[]) => a.length && parts.push(`${label}: ${a.join(", ")}`);
    add("Year", fTahun);
    add("Month", fBulan);
    add("Product", fProduct);
    add("Model unit", fModel);
    add("Customer Group", cGroup);
    add("Customer Name", cName);
    add("Branch", cBranch);
    add("PSS", cPss);
    add("KA Type", cKa);
    add("Price Type", cPrice);
    if (refYear !== null) parts.push(`Tahun acuan: ${refYear}${isYtd ? ` (Actual sampai ${ytdMonth})` : ""}`);
    if (search.trim()) parts.push(`Pencarian: ${search.trim()}`);
    return parts.join(" | ");
  }

  function cellText(r: RowM, c: ColDef): string {
    const v = r[c.key];
    if (c.key === "market_share") return fmtPct(r.market_share);
    if (c.key === "amount_market_size" || c.key === "amount_period" || c.key === "actual_sales") return fmtIDRFull(v as number);
    if (c.kind === "text") return (v as string) || "-";
    return fmtInt(v as number);
  }

  const headLabel = (c: ColDef) =>
    c.key === "amount_period"
      ? `Market Size ${monthsSelected === 12 ? "/year" : `${monthsSelected} months`} (Rp)`
      : c.key === "qty_period"
        ? `Qty Market Size ${monthsSelected === 12 ? "/year" : `${monthsSelected} months`}`
        : c.key === "actual_sales"
          ? `Actual Sales${refYear !== null ? ` ${refYear}` : ""} (Rp)`
          : c.label;

  async function onExport() {
    if (exporting || sorted.length === 0) return;
    setExporting(true);
    try {
      const ecols = cols.map((c) => ({ key: String(c.key), label: headLabel(c), width: c.width }));
      const num = (v: unknown, pct = false) => (typeof v === "number" ? (pct ? Math.round(v * 1000) / 10 : Math.round(v)) : "");
      const toRow = (r: Record<string, unknown>) => {
        const o: Record<string, string | number | null> = {};
        cols.forEach((c) => {
          const v = r[c.key as string];
          o[String(c.key)] = c.kind === "text" ? ((v as string) ?? "") : c.key === "market_share" ? (v === null ? "" : num(v, true)) : num(v);
        });
        return o;
      };
      const totalRow = toRow({ ...total });
      totalRow[String(LABEL_COLS[0].key)] = "TOTAL";
      await exportSummaryTableToExcel("Customer Group", ecols, sorted.map((r) => toRow(r as unknown as Record<string, unknown>)), totalRow, filterNote());
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      {/* BOX 1 — Filter */}
      <div className="panel">
        <div className="panel-head">
          <h2>Filter summary</h2>
          <div className="panel-tools">
            <span className="detail-filters-info">{busy ? "Menghitung…" : `${sorted.length.toLocaleString("id-ID")} baris`}</span>
            {hasFilter && (
              <button type="button" className="link-btn" onClick={resetAll}>
                Reset filter
              </button>
            )}
          </div>
        </div>
        <div className="detail-filters">
          <MultiSelectField
            label="Year"
            values={fTahun}
            options={tahunOpts}
            onChange={wrap(setFTahun)}
            info="Kosong = tahun terbaru yang punya data UIO. Actual Sales dan Market Size memakai tahun ini."
          />
          <MultiSelectField
            label="Month"
            values={fBulan}
            options={state.options.bulan}
            onChange={wrap(setFBulan)}
            info="Kosong = /year (12 bulan). Market Size bulan terpilih = jumlah kebutuhan part bulan-bulan itu (jam operasi unit per bulan mengikuti hari kerja kalender, unit baru dihitung mulai bulan belinya). Market share bulan terpilih memakai Actual per bulan dari sinkron web Sales."
          />
          <MultiSelectField label="Product" values={fProduct} options={productOpts} onChange={changeProduct} />
          <MultiSelectField label="Model unit" values={fModel} options={modelOpts} onChange={changeModel} />
          <MultiSelectField label="Customer Group" values={cGroup} options={groupOpts.group} onChange={wrap(setCGroup)} />
          <MultiSelectField label="Customer Name" values={cName} options={groupOpts.name} onChange={wrap(setCName)} />
          <MultiSelectField
            label="Branch"
            values={cBranch}
            options={groupOpts.branch}
            onChange={wrap(setCBranch)}
            info="Cabang customer: dari Master Customer, atau dari kolom Branch di Data UIO kalau Master Customer belum terisi. Customer yang punya unit di cabang terpilih ikut dihitung penuh."
          />
          <MultiSelectField
            label="PSS"
            values={cPss}
            options={groupOpts.pss}
            onChange={wrap(setCPss)}
            info="PSS dari Master Customer, atau dari kolom Pss Name di Data UIO kalau Master Customer belum terisi."
          />
          <MultiSelectField
            label="KA Type"
            values={cKa}
            options={groupOpts.ka}
            onChange={wrap(setCKa)}
            info="Key Account Type dari laporan Actual Sales (KA Nasional, KA Branch Platinum/Gold, NKA, Dealer, SHN)."
          />
          <MultiSelectField
            label="Contract / Non Contract"
            values={cPrice}
            options={[PRICE_CONTRACT, PRICE_NON]}
            onChange={wrap(setCPrice)}
            info="Contract (SCPL) = Customer Group-nya punya harga di Data Harga Kontrak. Non Contract = tidak punya, memakai harga non kontrak."
          />
        </div>
      </div>

      {/* BOX 2 — Tabel summary */}
      <div className="panel">
        <div className="panel-head">
          <h2>Summary per Customer Group</h2>
          {refYear !== null && (
            <span className="detail-filters-info" title="Tahun & bulan yang dipakai tabel ini (dari filter Tahun / Bulan)">
              Periode: {fBulan.length > 0 ? `${refYear} · ${fBulan.length === 12 ? "/year" : fBulan.join(", ")}` : plan.labelOf(refYear)}
              {fProduct.length > 0 ? ` · Product: ${fProduct.join(", ")}` : ""}
              {fModel.length > 0 ? ` · Model: ${fModel.length > 3 ? `${fModel.slice(0, 3).join(", ")} +${fModel.length - 3}` : fModel.join(", ")}` : ""}
            </span>
          )}
          <div className="panel-tools">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={pageRows.length === 0}
              onClick={() => setExpanded((prev) => (pageRows.every((r) => prev.has(r.id)) ? new Set() : new Set(pageRows.map((r) => r.id))))}
              title="Buka / tutup customer semua group di halaman ini"
            >
              {pageRows.length > 0 && pageRows.every((r) => expanded.has(r.id)) ? "− Tutup semua" : "+ Buka semua"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={exporting || sorted.length === 0}
              onClick={onExport}
              title="Unduh tabel (sesuai filter) sebagai Excel"
            >
              {exporting ? "Menyiapkan…" : "⭳ Ekspor Excel"}
            </button>
            <input
              className="search-input"
              placeholder="Cari group, customer, branch, PSS, product, model…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
        {refYear !== null && !comparable && (
          <div className="detail-filters-info" style={{ padding: "0 16px 10px" }}>
            Market share tidak dihitung: {plan.whyNot(refYear)}
          </div>
        )}
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={String(c.key)} onClick={() => onSort(c.key)} style={{ cursor: "pointer" }} className={c.kind === "computed" ? "computed" : undefined}>
                    {headLabel(c)}
                    {sortCol === c.key && <span className="arrow">{sortDir === "asc" ? "▲" : "▼"}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const open = expanded.has(r.id);
                const kids = open ? childCache.get(r.id) : undefined;
                return (
                  <Fragment key={r.id}>
                    <tr>
                      {cols.map((c, i) => (
                        <td key={String(c.key)} className={c.kind === "computed" ? "computed" : undefined}>
                          {i === 0 ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                              <button
                                type="button"
                                onClick={() => toggleGroup(r.id)}
                                aria-expanded={open}
                                aria-label={open ? "Tutup customer" : "Tampilkan customer"}
                                title={open ? "Tutup customer" : "Tampilkan customer"}
                                style={{
                                  width: 22,
                                  height: 22,
                                  lineHeight: "18px",
                                  borderRadius: 4,
                                  border: "1px solid var(--line, #c9d1dc)",
                                  background: "transparent",
                                  color: "inherit",
                                  cursor: "pointer",
                                  fontWeight: 700,
                                  flex: "none"
                                }}
                              >
                                {open ? "−" : "+"}
                              </button>
                              {cellText(r, c)}
                            </span>
                          ) : (
                            cellText(r, c)
                          )}
                        </td>
                      ))}
                    </tr>
                    {open && !kids && (
                      <tr>
                        <td colSpan={cols.length} style={{ paddingLeft: 44, color: "var(--ink-mute)" }}>
                          Menghitung customer…
                        </td>
                      </tr>
                    )}
                    {open && kids && kids.length === 0 && (
                      <tr>
                        <td colSpan={cols.length} style={{ paddingLeft: 44, color: "var(--ink-mute)" }}>
                          Tidak ada customer dengan unit UIO atau Actual Sales.
                        </td>
                      </tr>
                    )}
                    {kids?.map((k0) => {
                      const k = withMetrics(k0);
                      return (
                        <tr key={`${r.id}>${k.id}`} style={{ background: "rgba(127,127,127,0.07)" }}>
                          {cols.map((c, i) => (
                            <td key={String(c.key)} className={c.kind === "computed" ? "computed" : undefined}>
                              {i === 0 ? (
                                <span style={{ paddingLeft: 30, color: "var(--ink-mute)" }}>↳</span>
                              ) : (
                                cellText(k, c)
                              )}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
              {sorted.length > 0 && (
                <tr style={{ fontWeight: 600 }}>
                  {cols.map((c, i) => (
                    <td key={String(c.key)} className={c.kind === "computed" ? "computed" : undefined}>
                      {i === 0
                        ? "TOTAL"
                        : c.kind === "text"
                          ? ""
                          : c.key === "market_share"
                            ? fmtPct(total.market_share as number | null)
                            : c.key === "amount_market_size" || c.key === "amount_period" || c.key === "actual_sales"
                              ? fmtIDRFull(total[c.key as string] as number)
                              : fmtInt(total[c.key as string] as number)}
                    </td>
                  ))}
                </tr>
              )}
              {sorted.length === 0 && !busy && (
                <tr>
                  <td colSpan={cols.length} style={{ textAlign: "center", color: "var(--ink-mute)" }}>
                    Tidak ada data untuk filter ini.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="pagination">
          <button disabled={currentPage <= 1} onClick={() => setPage((p) => p - 1)}>
            ‹ Sebelumnya
          </button>
          <span>
            Halaman {currentPage} / {pages} · {sorted.length.toLocaleString("id-ID")} baris
          </span>
          <button disabled={currentPage >= pages} onClick={() => setPage((p) => p + 1)}>
            Berikutnya ›
          </button>
        </div>
      </div>
    </>
  );
}
