"use client";

import { useEffect, useMemo, useState } from "react";
import type { UseDashboardState } from "@/hooks/useDashboardState";
import {
  EMPTY_FILTERS,
  aggregateGroup,
  buildDetailRows,
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
import { monthsShare } from "@/lib/workdays";
import { CUSTOMER_TIER_OPTIONS, MONTH_ORDER, type UioUnit } from "@/lib/types";

const PAGE_SIZE = 20;
const PRICE_CONTRACT = "Contract (SCPL)";
const PRICE_NON = "Non Contract";

/** Satu baris tabel = satu Customer Group atau satu Customer (pilihan "Tampilkan per"). */
type Level = "customer" | "group";
type Row = GroupRow & { id: string; grp: string; cname: string; branch: string; pss: string; katype: string; pkind: string; kaList: string[] };
type RowM = Row & { qty_period: number; share_den: number };
type SortKey = keyof RowM;
type ColDef = { key: SortKey; label: string; kind: "text" | "num" | "computed"; width?: number };

const METRIC_COLS: ColDef[] = [
  { key: "customers", label: "Customer", kind: "num", width: 12 },
  { key: "uio", label: "UIO (unit)", kind: "num", width: 12 },
  { key: "qty_market_size", label: "Qty market size", kind: "computed", width: 16 },
  { key: "qty_period", label: "Qty Market Size/m", kind: "computed", width: 20 },
  { key: "amount_market_size", label: "Market Size (Rp)", kind: "computed", width: 20 },
  { key: "amount_period", label: "Market Size/m (Rp)", kind: "computed", width: 24 },
  { key: "actual_sales", label: "Actual sales (Rp)", kind: "num", width: 20 },
  { key: "market_share", label: "Market share", kind: "computed", width: 14 }
];
const LABEL_COLS: ColDef[] = [
  { key: "grp", label: "Customer Group", kind: "text", width: 32 },
  { key: "katype", label: "KA Type", kind: "text", width: 24 },
  { key: "cname", label: "Customer Name", kind: "text", width: 36 },
  { key: "branch", label: "Branch", kind: "text", width: 18 },
  { key: "pss", label: "PSS", kind: "text", width: 22 },
  { key: "pkind", label: "Harga", kind: "text", width: 16 }
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
const tierRank = (t: string) => {
  const i = CUSTOMER_TIER_OPTIONS.indexOf(t as (typeof CUSTOMER_TIER_OPTIONS)[number]);
  return i === -1 ? 999 : i;
};
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
  const [fPartName, setFPartName] = useState<string[]>([]);
  const [cGroup, setCGroup] = useState<string[]>([]);
  const [cName, setCName] = useState<string[]>([]); // Customer Name
  const [cBranch, setCBranch] = useState<string[]>([]); // Branch (cabang Master Customer / branch Data UIO)
  const [cPss, setCPss] = useState<string[]>([]); // PSS
  const [cKa, setCKa] = useState<string[]>([]); // KA Type (KA NASIONAL, KA BRANCH GOLD, NKA, dst)
  const [cPrice, setCPrice] = useState<string[]>([]); // Contract (SCPL) / Non Contract

  const [level, setLevel] = useState<Level>("customer");
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
  const partNameOpts = useMemo(() => {
    const ps = new Set(fProduct);
    const ms = new Set(fModel);
    return uniq(
      data.parts.filter((p) => (ps.size === 0 || ps.has(p.product)) && (ms.size === 0 || ms.has(p.model))).map((p) => p.part_name)
    ).sort();
  }, [data.parts, fProduct, fModel]);

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
    data.actualSalesYear.forEach((r) => {
      const g = get(r.customer_group, r.customer_name);
      if (!g) return;
      g.actual.set(r.year, (g.actual.get(r.year) || 0) + r.amount);
      if (r.ka_type) g.kaAmount.set(r.ka_type, (g.kaAmount.get(r.ka_type) || 0) + r.amount);
    });
    return Array.from(m.values());
  }, [customers, data.uioUnits, data.actualSalesYear]);

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
    const names = new Set(avail.map((p) => p.part_name));
    setFModel((m) => m.filter((x) => models.has(x)));
    setFPartName((n) => n.filter((x) => names.has(x)));
    setPage(1);
  }
  function changeModel(next: string[]) {
    setFModel(next);
    const ps = new Set(fProduct);
    const ms = new Set(next);
    const names = new Set(
      data.parts.filter((p) => (ps.size === 0 || ps.has(p.product)) && (ms.size === 0 || ms.has(p.model))).map((p) => p.part_name)
    );
    setFPartName((n) => n.filter((x) => names.has(x)));
    setPage(1);
  }
  const wrap = (set: (v: string[]) => void) => (v: string[]) => {
    set(v);
    setPage(1);
  };

  const hasFilter =
    fTahun.length + fBulan.length + fProduct.length + fModel.length + fPartName.length + cGroup.length + cName.length + cBranch.length + cPss.length + cKa.length + cPrice.length > 0;

  function resetAll() {
    [setFTahun, setFBulan, setFProduct, setFModel, setFPartName, setCGroup, setCName, setCBranch, setCPss, setCKa, setCPrice].forEach((s) => s([]));
    setSearch("");
    setPage(1);
  }

  // Filter yang dipakai untuk menghitung: HANYA yang ada di box filter ini.
  const calcFilters = useMemo(
    () => ({ ...EMPTY_FILTERS, tahun: fTahun, bulan: fBulan, product: fProduct, modelUnit: fModel, partName: fPartName }),
    [fTahun, fBulan, fProduct, fModel, fPartName]
  );
  const monthsSelected = fBulan.length > 0 ? new Set(fBulan).size : 12;
  const share = fBulan.length > 0 ? monthsShare(fBulan) : 1;

  // Tahun acuan: tahun terpilih (terbesar) atau tahun UIO terbaru; kalau belum ada UIO, tahun Actual Sales terbaru.
  const refYear = useMemo(() => {
    const ys = resolveUioYears(calcFilters, data.uioUnits);
    if (ys.length > 0) return Math.max(...ys);
    const ay = data.actualSalesYear.map((r) => r.year);
    return ay.length > 0 ? Math.max(...ay) : null;
  }, [calcFilters, data.uioUnits, data.actualSalesYear]);

  // Data Actual Sales tahun terbaru biasanya YTD: Market Size pembandingnya dipotong sampai bulan yang sama.
  const ytdYear = data.meta.actual_year_ytd_year ?? null;
  const ytdMonth = data.meta.actual_year_ytd_month ?? null;
  const ytdIdx = ytdMonth ? (MONTH_ORDER as readonly string[]).indexOf(ytdMonth) : -1;
  const isYtd = refYear !== null && refYear === ytdYear && ytdIdx >= 0 && ytdIdx < 11;
  const actualFactor = isYtd ? monthsShare(MONTH_ORDER.slice(0, ytdIdx + 1)) : 1;
  const actualYearHas = refYear !== null && data.actualSalesYear.some((r) => r.year === refYear);
  // Actual Sales berupa total setahun semua product: hanya sebanding kalau tidak ada filter Bulan/Product/Model/Part.
  const comparable = fBulan.length === 0 && fProduct.length === 0 && fModel.length === 0 && fPartName.length === 0;

  // ---- entitas yang lolos filter customer; per Customer Group = gabungan customer yang lolos ----
  const selected = useMemo<GInfo[]>(() => {
    const sel = { group: new Set(cGroup), name: new Set(cName), branch: new Set(cBranch), pss: new Set(cPss), ka: new Set(cKa), price: new Set(cPrice) };
    const passed = custEntities.filter(
      (g) =>
        (sel.group.size === 0 || sel.group.has(g.name)) &&
        (sel.name.size === 0 || sel.name.has(g.custName)) &&
        (sel.branch.size === 0 || branchOf(g).some((b) => sel.branch.has(b))) &&
        (sel.pss.size === 0 || pssOf(g).some((p) => sel.pss.has(p))) &&
        (sel.ka.size === 0 || kaOf(g).some((k) => sel.ka.has(k))) &&
        (sel.price.size === 0 || sel.price.has(priceKindOf(g)))
    );
    if (level === "customer") return passed;
    const merged = new Map<string, GInfo>();
    passed.forEach((g) => {
      const key = normGroup(g.name);
      let t = merged.get(key);
      if (!t) {
        t = { key, name: g.name, custName: "", custNames: new Set(), tiers: new Set(), kaAmount: new Map(), actual: new Map(), units: [], branches: new Map(), pssNames: new Map() };
        merged.set(key, t);
      }
      g.custNames.forEach((n) => t!.custNames.add(n));
      g.tiers.forEach((x) => t!.tiers.add(x));
      g.kaAmount.forEach((v, k) => t!.kaAmount.set(k, (t!.kaAmount.get(k) || 0) + v));
      g.actual.forEach((v, y) => t!.actual.set(y, (t!.actual.get(y) || 0) + v));
      g.branches.forEach((v, k) => t!.branches.set(k, (t!.branches.get(k) || 0) + v));
      g.pssNames.forEach((v, k) => t!.pssNames.set(k, (t!.pssNames.get(k) || 0) + v));
      t.units.push(...g.units);
    });
    return Array.from(merged.values());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [custEntities, contractNameByKey, cGroup, cName, cBranch, cPss, cKa, cPrice, level]);

  // ---- hitung per baris (bertahap supaya halaman tetap responsif) ----
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const ctx = prepareDetailCtx(data.parts, data.uioUnits, data.priceList, [], calcFilters);

    const out: Row[] = [];
    let i = 0;
    setBusy(true);
    const step = () => {
      if (cancelled) return;
      const t0 = performance.now();
      while (i < selected.length && performance.now() - t0 < 12) {
        const g = selected[i++];
        const actual = refYear !== null ? g.actual.get(refYear) || 0 : 0;
        if (g.units.length === 0 && actual === 0) continue;
        const nCust = g.custNames.size || 1;
        // Tanpa unit UIO tidak ada Market Size (tidak dihitung supaya tidak memakai perkiraan nasional).
        const list =
          g.units.length === 0
            ? []
            : buildDetailRows(data.parts, data.assumptions, data.uioUnits, data.priceList, data.customers, [], calcFilters, new Set([g.key]), {
                units: g.units,
                tx: [],
                priceGroup: contractNameByKey.get(normGroup(g.name)) || g.name,
                ctx
              });
        const agg = aggregateGroup(g.name, nCust, list);
        const ka = kaOf(g);
        const cname = level === "customer" ? g.custName : nCust > 1 ? `${nCust.toLocaleString("id-ID")} customer` : Array.from(g.custNames)[0] || "";
        out.push({
          ...agg,
          actual_sales: actual,
          id: g.key,
          grp: g.name,
          cname,
          branch: topList(g.branches),
          pss: topList(g.pssNames),
          katype: ka.join(", "),
          kaList: ka,
          pkind: priceKindOf(g)
        });
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
  }, [selected, contractNameByKey, data, calcFilters, refYear, level]);

  const cols: ColDef[] = useMemo(() => [...LABEL_COLS, ...METRIC_COLS], []);
  const textKeys = useMemo(() => cols.filter((c) => c.kind === "text").map((c) => c.key), [cols]);

  // Market Size/m = Market Size setahun × bagian hari kerja bulan terpilih (12 bulan kalau filter Bulan kosong).
  // Market share = Actual Sales tahun acuan ÷ Market Size periode yang sama (sampai bulan terakhir data, kalau YTD).
  const rowsM = useMemo<RowM[]>(
    () =>
      rows.map((r) => {
        const den = r.amount_market_size * actualFactor;
        return {
          ...r,
          qty_period: r.qty_market_size * share,
          amount_period: r.amount_market_size * share,
          share_den: den,
          market_share: comparable && actualYearHas && den > 0 ? r.actual_sales / den : null
        };
      }),
    [rows, share, actualFactor, comparable, actualYearHas]
  );

  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? rowsM.filter((r) => textKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(q))) : rowsM.slice();
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
      market_share: comparable && actualYearHas && den > 0 ? sum((g) => g.actual_sales) / den : null
    } as Record<string, number | null>;
  }, [sorted, comparable, actualYearHas]);

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
    add("Tahun", fTahun);
    add("Bulan", fBulan);
    add("Product", fProduct);
    add("Model unit", fModel);
    add("Part name", fPartName);
    add("Customer Group", cGroup);
    add("Customer Name", cName);
    add("Branch", cBranch);
    add("PSS", cPss);
    add("KA Type", cKa);
    add("Harga", cPrice);
    parts.push(`Tampilan: per ${level === "customer" ? "Customer" : "Customer Group"}`);
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
      ? `Market Size/m (${monthsSelected} bln) (Rp)`
      : c.key === "qty_period"
        ? `Qty Market Size/m (${monthsSelected} bln)`
        : c.key === "actual_sales"
          ? `Actual sales${refYear !== null ? ` ${refYear}` : ""} (Rp)`
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
      await exportSummaryTableToExcel(level === "customer" ? "Customer" : "Customer Group", ecols, sorted.map((r) => toRow(r as unknown as Record<string, unknown>)), totalRow, filterNote());
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
            label="Tahun"
            values={fTahun}
            options={tahunOpts}
            onChange={wrap(setFTahun)}
            info="Kosong = tahun terbaru yang punya data UIO. Actual Sales dan Market Size memakai tahun ini."
          />
          <MultiSelectField
            label="Bulan"
            values={fBulan}
            options={state.options.bulan}
            onChange={wrap(setFBulan)}
            info="Kosong = 12 bulan. Market Size/m dan Qty Market Size/m = nilai setahun × bagian hari kerja bulan yang dipilih. Actual Sales hanya tersedia per tahun, jadi Market share tidak dihitung kalau Bulan dipilih."
          />
          <MultiSelectField label="Product" values={fProduct} options={productOpts} onChange={changeProduct} />
          <MultiSelectField label="Model unit" values={fModel} options={modelOpts} onChange={changeModel} />
          <MultiSelectField label="Part name" values={fPartName} options={partNameOpts} onChange={wrap(setFPartName)} />
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
          <h2>Summary per {level === "customer" ? "Customer" : "Customer Group"}</h2>
          <div className="panel-tools">
            <span className="detail-filters-info">Tampilkan per</span>
            {(["customer", "group"] as Level[]).map((l) => (
              <button
                key={l}
                type="button"
                className="btn btn-ghost"
                style={level === l ? { fontWeight: 700, borderColor: "var(--brand, #0f4c81)" } : undefined}
                aria-pressed={level === l}
                onClick={() => {
                  setLevel(l);
                  setPage(1);
                }}
              >
                {l === "customer" ? "Customer" : "Customer Group"}
              </button>
            ))}
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
              placeholder="Cari customer, group, branch, PSS…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
        {(refYear !== null || !comparable) && (
          <div className="detail-filters-info" style={{ padding: "0 16px 10px" }}>
            {refYear !== null && (
              <>
                Tahun acuan {refYear}
                {isYtd ? ` · Actual Sales sampai ${ytdMonth}, jadi Market share dibandingkan dengan Market Size Januari–${ytdMonth}` : ""}.{" "}
              </>
            )}
            {!actualYearHas && refYear !== null && "Belum ada Actual Sales untuk tahun ini. "}
            {!comparable && "Market share tidak dihitung kalau filter Bulan, Product, Model, atau Part dipilih (Actual Sales berupa total setahun semua product)."}
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
              {pageRows.map((r) => (
                <tr key={r.id}>
                  {cols.map((c) => (
                    <td key={String(c.key)} className={c.kind === "computed" ? "computed" : undefined}>
                      {cellText(r, c)}
                    </td>
                  ))}
                </tr>
              ))}
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
