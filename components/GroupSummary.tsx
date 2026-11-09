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
import LevelPicker, { activeLevels } from "@/components/LevelPicker";
import { exportSummaryTableToExcel } from "@/lib/exportDetail";
import { comparePlan, periodOf, sumPeriod } from "@/lib/period";
import { type UioUnit } from "@/lib/types";
import { kaRank } from "@/lib/references";
import { PRICE_TYPE_LABEL, UIO_PRICE_TYPE_OPTIONS, codesOf, codesWithContract, dominantPriceType, groupsWithGroupPrice, type PriceType } from "@/lib/priceType";

const PAGE_SIZE = 20;
/** Baris anak per baris induk yang ditampilkan dulu. */
const KID_CAP = 50;
const PRICE_OPTIONS = UIO_PRICE_TYPE_OPTIONS; // Kontrak, SCPL, Non-Kontrak

/** Satu baris tabel = satu Customer Group; tombol + membuka baris per Customer di bawahnya. */
type Weights = { grp: Map<string, number>; ka: Map<string, number>; br: Map<string, number>; pss: Map<string, number>; prod: Map<string, number>; model: Map<string, number>; pk: Map<string, number>; names: Set<string> };
type Row = GroupRow & {
  id: string; grp: string; cname: string; branch: string; pss: string; katype: string; pkind: string;
  /** Product / Model yang ada di baris ini (Market Size terbesar dulu) — mengikuti filter Product / Model unit. */
  product: string; model: string;
  kaList: string[]; allNames: string;
  /** Bobot mentah untuk menggabungkan baris (level hierarki). */
  w: Weights;
};

/** Dimensi Hierarchy Controls di tabel Summary. */
const SUM_DIMS = ["katype", "group", "customer", "branch", "pss", "pkind"] as const;
type SumDim = (typeof SUM_DIMS)[number];
const SUM_LABELS: Record<SumDim, string> = {
  katype: "Customer Type", group: "Customer Group", customer: "Customer Name", branch: "Branch", pss: "PSS", pkind: "Price Type"
};
/** Kolom tabel untuk tiap dimensi hierarki. */
const DIM_COL: Record<SumDim, string> = { katype: "katype", group: "grp", customer: "cname", branch: "branch", pss: "pss", pkind: "pkind" };
/** Kolom yang berkaitan dengan level terakhir hierarki (atribut dari baris di level itu). */
const RELATED_COLS: Record<SumDim, string[]> = {
  katype: ["product", "model", "pkind"],
  group: ["katype", "branch", "pss", "product", "model", "pkind"],
  customer: ["grp", "katype", "branch", "pss", "product", "model", "pkind"],
  branch: ["pss", "product", "model"],
  pss: ["branch", "product", "model"],
  pkind: ["katype", "product", "model"]
};
const topKey = (m: Map<string, number>) => {
  let best = "", bv = -Infinity;
  m.forEach((v, k) => {
    if (k && (v > bv || (v === bv && k < best))) {
      best = k;
      bv = v;
    }
  });
  return best;
};
const mergeInto = (into: Map<string, number>, from: Map<string, number>) => from.forEach((v, k) => addCount(into, k, v));
type SNode = { id: string; dim: SumDim; label: string; depth: number; agg: RowM; custs: Row[]; children: SNode[] };
type RowM = Row & { qty_period: number; share_den: number };
type SortKey = keyof RowM | "hier";
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
  { key: "katype", label: "Customer Type", kind: "text", width: 24 },
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
  const [cKa, setCKa] = useState<string[]>([]); // Customer Type (KA NASIONAL, KA BRANCH GOLD, NKA, dst)
  const [cPrice, setCPrice] = useState<string[]>([]); // Price Type: Kontrak / SCPL / Non-Kontrak

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [levels, setLevels] = useState<(SumDim | "")[]>(["group", "", "", ""]);
  // Level 1 = none → tabel datar per customer.
  const act = useMemo(() => {
    const a = activeLevels(levels);
    return a.length > 0 ? a : (["customer"] as SumDim[]);
  }, [levels]);
  const [kidShow, setKidShow] = useState<Map<string, number>>(new Map());
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
    tiers: Set<string>; // dari Master Customer (atau Cust. Type di Data UIO)
    masterTier?: boolean;
    kaAmount: Map<string, number>; // Customer Type dari laporan Actual Sales -> total nilai
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
      if (c.tier) {
        g.tiers.add(c.tier.trim().toUpperCase());
        g.masterTier = true;
      }
      addCount(g.branches, normText(c.cabang), 1000);
      addCount(g.pssNames, normText(c.pss), 1000);
    });
    data.uioUnits.forEach((u) => {
      const g = get(u.customer_group || "", u.customer_name || "");
      if (!g) return;
      g.units.push(u);
      // Customer Type dari kolom Cust. Type di Data UIO hanya kalau Master Customer tidak punya.
      if (u.customer_type && !g.masterTier) g.tiers.add(u.customer_type.trim().toUpperCase());
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

  // Customer Group yang punya harga Kontrak / SCPL; simpan ejaan persis di Data Harga untuk pencarian harga.
  const contractNameByKey = useMemo(() => groupsWithGroupPrice(data.priceList), [data.priceList]);
  /** Customer Code yang punya harga Kontrak / SCPL (untuk customer yang Price Type-nya belum diisi di Data UIO). */
  const groupPriceKinds = useMemo(() => codesWithContract(data.priceList), [data.priceList]);

  const kaOf = (g: GInfo): string[] => {
    const fromActual = Array.from(g.kaAmount.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k);
    if (fromActual.length > 0) return fromActual.sort(byTier);
    return Array.from(g.tiers).sort(byTier);
  };
  /** Price Type tiap customer di entitas ini: dari Data UIO (terbanyak per customer); kalau belum diisi → harga yang
   * tersedia untuk Customer Group-nya (Kontrak, lalu SCPL), selain itu Non-Kontrak. Sama dengan aturan perhitungan. */
  const custPriceTypes = (g: GInfo): Map<string, PriceType> => {
    const byCust = new Map<string, UioUnit[]>();
    g.units.forEach((u) => {
      const k = custKey(u.customer_group, u.customer_name);
      const arr = byCust.get(k);
      if (arr) arr.push(u);
      else byCust.set(k, [u]);
    });
    // Price Type belum diisi → dari Data Harga: Customer Code-nya punya harga Kontrak / SCPL, selain itu Non-Kontrak.
    const legacyOf = (us: UioUnit[]): PriceType => {
      const kinds = new Set<PriceType>();
      codesOf(us).forEach((c) => groupPriceKinds.get(c)?.forEach((t) => kinds.add(t)));
      return kinds.has("contract") ? "contract" : kinds.has("scpl") ? "scpl" : "non_contract";
    };
    const out = new Map<string, PriceType>();
    byCust.forEach((us, k) => out.set(k, dominantPriceType(us) ?? legacyOf(us)));
    if (out.size === 0) out.set(g.key, "non_contract");
    return out;
  };
  const priceKinds = (g: GInfo): string[] => {
    const set = new Set(custPriceTypes(g).values());
    return (["contract", "scpl", "non_contract"] as PriceType[]).filter((t) => set.has(t)).map((t) => PRICE_TYPE_LABEL[t]);
  };
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
      (skip === "price" || sel.price.size === 0 || priceKinds(g).some((k) => sel.price.has(k)));
    return {
      group: uniq(custEntities.filter((g) => ok(g, "group")).map((g) => g.name)).sort(),
      name: uniq(custEntities.filter((g) => ok(g, "name")).map((g) => g.custName)).sort(),
      branch: uniq(custEntities.filter((g) => ok(g, "branch")).flatMap((g) => branchOf(g))).sort(),
      pss: uniq(custEntities.filter((g) => ok(g, "pss")).flatMap((g) => pssOf(g))).sort(),
      ka: uniq(custEntities.filter((g) => ok(g, "ka")).flatMap((g) => kaOf(g))).sort(byTier)
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [custEntities, contractNameByKey, groupPriceKinds, cGroup, cName, cBranch, cPss, cKa, cPrice]);

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
        (sel.price.size === 0 || priceKinds(g).some((k) => sel.price.has(k)))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [custEntities, contractNameByKey, groupPriceKinds, cGroup, cName, cBranch, cPss, cKa, cPrice]);

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
    // Unit dipisah per Price Type customer-nya (Kontrak / SCPL / Non-Kontrak), lalu dihitung dengan harga masing-masing.
    const list: ReturnType<typeof buildDetailRows> = [];
    if (g.units.length > 0) {
      const types = custPriceTypes(g);
      const byType = new Map<PriceType, UioUnit[]>();
      g.units.forEach((u) => {
        const t = types.get(custKey(u.customer_group, u.customer_name)) ?? "non_contract";
        const arr = byType.get(t);
        if (arr) arr.push(u);
        else byType.set(t, [u]);
      });
      byType.forEach((units, t) => {
        list.push(
          ...buildDetailRows(data.parts, data.uioUnits, data.priceList, data.customers, [], calcFilters, new Set([g.key]), {
            units,
            tx: [],
            priceGroup: contractNameByKey.get(normGroup(g.name)) || g.name,
            priceType: t,
            ctx: detailCtx
          })
        );
      });
    }
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
      pkind: priceKinds(g).join(", "),
      allNames: Array.from(g.custNames).join(" | ").toLowerCase(),
      w: {
        grp: new Map([[g.name, 1]]),
        ka: new Map(ka.map((k) => [k, 1])),
        br: new Map(g.branches),
        pss: new Map(g.pssNames),
        prod: prodW,
        model: modelW,
        pk: new Map(priceKinds(g).map((k) => [k, 1])),
        names: new Set(isCustomer ? [g.custName] : Array.from(g.custNames))
      }
    };
  }

  // ---- hitung baris per Customer (bertahap supaya halaman tetap responsif); level hierarki = gabungan customer ----
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [calcPct, setCalcPct] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const out: Row[] = [];
    let i = 0;
    setBusy(true);
    setCalcPct(0);
    const step = () => {
      if (cancelled) return;
      const t0 = performance.now();
      while (i < passed.length && performance.now() - t0 < 14) {
        const r = computeRow(passed[i++], true);
        if (r) out.push(r);
      }
      if (i < passed.length) {
        setCalcPct(i / passed.length);
        timers.push(setTimeout(step, 0));
      } else {
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
  }, [passed, contractNameByKey, data, calcFilters, refYear, detailCtx]);

  function toggleNode(id: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  // Kolom yang tampil mengikuti level hierarki: hanya kolom yang berkaitan dengan level terakhir,
  // dan kolom yang sudah jadi level hierarki tidak diulang.
  const cols: ColDef[] = useMemo(() => {
    const last = act[act.length - 1] ?? "group";
    const used = new Set<string>(act.map((d) => DIM_COL[d]));
    const rel = new Set(RELATED_COLS[last].filter((k) => !used.has(k)));
    const metrics = METRIC_COLS.filter((c) => !(c.key === "customers" && last === "customer"));
    return [{ key: "hier" as SortKey, label: "Hierarchy", kind: "text", width: 34 }, ...LABEL_COLS.filter((c) => rel.has(String(c.key))), ...metrics];
  }, [act]);
  // Pencarian tetap memeriksa semua kolom teks (termasuk yang tidak tampil).
  const textKeys = useMemo(() => LABEL_COLS.map((c) => c.key), []);

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
  // Customer yang lolos pencarian (pencarian berlaku di level customer).
  const custList = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => r.allNames.includes(q) || textKeys.some((k) => String(r[k as keyof Row] ?? "").toLowerCase().includes(q))) : rows;
  }, [rows, search, textKeys]);

  /** Gabungkan beberapa baris customer jadi satu baris level. */
  const aggRows = (list: Row[], id: string, label: string): Row => {
    const w: Weights = { grp: new Map(), ka: new Map(), br: new Map(), pss: new Map(), prod: new Map(), model: new Map(), pk: new Map(), names: new Set() };
    const g = aggregateGroup(label, 0, []);
    list.forEach((r) => {
      g.customers += r.customers;
      g.uio += r.uio;
      g.qty_market_size += r.qty_market_size;
      g.amount_market_size += r.amount_market_size;
      g.actual_qty += r.actual_qty;
      g.actual_sales += r.actual_sales;
      g.period_market += r.period_market;
      g.amount_per_month += r.amount_per_month;
      g.amount_period += r.amount_period;
      for (let m = 0; m < 12; m++) {
        g.qty_months[m] += r.qty_months[m];
        g.amount_months[m] += r.amount_months[m];
      }
      addCount(w.grp, r.grp, r.amount_market_size + 1);
      mergeInto(w.ka, r.w.ka);
      mergeInto(w.br, r.w.br);
      mergeInto(w.pss, r.w.pss);
      mergeInto(w.prod, r.w.prod);
      mergeInto(w.model, r.w.model);
      mergeInto(w.pk, r.w.pk);
      r.w.names.forEach((n) => w.names.add(n));
    });
    const kaList = Array.from(w.ka.keys()).sort(byTier);
    const nNames = w.names.size;
    return {
      ...g,
      id,
      grp: topList(w.grp),
      cname: nNames === 1 ? Array.from(w.names)[0] : `${nNames.toLocaleString("id-ID")} customer`,
      branch: topList(w.br),
      pss: topList(w.pss),
      product: topList(w.prod),
      model: topList(w.model),
      katype: kaList.join(", "),
      kaList,
      pkind: PRICE_OPTIONS.filter((k) => w.pk.has(k)).join(", "),
      allNames: "",
      w
    };
  };
  /** Kalau filter dimensi yang sama aktif, nilai yang dipakai hierarki dibatasi ke pilihan filter
   * (mis. filter Branch PTK → customer yang unitnya di PKU & PTK masuk ke baris PTK, bukan PKU). */
  const within = (m: Map<string, number>, sel: string[]): Map<string, number> => {
    if (sel.length === 0) return m;
    const s = new Set(sel);
    const out = new Map(Array.from(m).filter(([k]) => s.has(k)));
    return out.size > 0 ? out : m;
  };
  const dimOf = (d: SumDim, r: Row): string => {
    switch (d) {
      case "katype": return (cKa.length > 0 ? r.kaList.find((k) => cKa.includes(k)) : undefined) || r.kaList[0] || "(Tanpa Customer Type)";
      case "group": return r.grp || "(Tanpa Group)";
      case "customer": return r.cname || "(Tanpa Nama)";
      case "branch": return topKey(within(r.w.br, cBranch)) || "(Tanpa Branch)";
      case "pss": return topKey(within(r.w.pss, cPss)) || "(Tanpa PSS)";
      case "pkind": return PRICE_OPTIONS.find((k) => r.w.pk.has(k) && (cPrice.length === 0 || cPrice.includes(k))) || PRICE_OPTIONS.find((k) => r.w.pk.has(k)) || "Non-Kontrak";
    }
  };
  const sortRows = <T extends { agg: RowM; label: string }>(list: T[]): T[] => {
    const key: SortKey = sortCol;
    return list.sort((a, b) => {
      const av = key === "hier" ? a.label : a.agg[key as keyof RowM] ?? 0;
      const bv = key === "hier" ? b.label : b.agg[key as keyof RowM] ?? 0;
      if (typeof av === "string" && typeof bv === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  };
  const tree = useMemo<SNode[]>(() => {
    const build = (list: Row[], depth: number, parent: string): SNode[] => {
      if (depth >= act.length) return [];
      const d = act[depth];
      const m = new Map<string, Row[]>();
      list.forEach((r) => {
        const k = dimOf(d, r);
        const arr = m.get(k);
        if (arr) arr.push(r);
        else m.set(k, [r]);
      });
      return sortRows(
        Array.from(m.entries()).map(([label, rs]) => {
          const id = `${parent}¦${d}:${label}`;
          return { id, dim: d, label, depth, custs: rs, agg: withMetrics(aggRows(rs, id, label)), children: build(rs, depth + 1, id) };
        })
      );
    };
    return build(custList, 0, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [custList, act, sortCol, sortDir, cBranch, cPss, cKa, cPrice, selMonths?.join(","), denMonths?.join(","), comparable]);

  const pages = Math.max(1, Math.ceil(tree.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const pageNodes = tree.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const lastIsCustomer = act[act.length - 1] === "customer";
  /** Baris yang tampil: node level + (di level terakhir, kalau bukan Customer Name) daftar customer-nya. */
  type Vis = { kind: "node"; n: SNode } | { kind: "cust"; r: RowM; depth: number; parent: string } | { kind: "more"; parent: string; depth: number; left: number };
  const visible = useMemo<Vis[]>(() => {
    const out: Vis[] = [];
    const walk = (ns: SNode[]) => ns.forEach((n) => {
      out.push({ kind: "node", n });
      if (!expanded.has(n.id)) return;
      const cap = kidShow.get(n.id) ?? KID_CAP;
      const total = n.children.length > 0 ? n.children.length : lastIsCustomer ? 0 : n.custs.length;
      if (n.children.length > 0) walk(n.children.slice(0, cap));
      else if (!lastIsCustomer)
        sortRows(n.custs.map((r) => ({ agg: withMetrics(r), label: r.cname })))
          .slice(0, cap)
          .forEach((x) => out.push({ kind: "cust", r: x.agg, depth: n.depth + 1, parent: n.id }));
      if (total > cap) out.push({ kind: "more", parent: n.id, depth: n.depth + 1, left: total - cap });
    });
    walk(pageNodes);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNodes, expanded, lastIsCustomer, sortCol, sortDir, kidShow]);
  const canOpen = (n: SNode) => n.children.length > 0 || !lastIsCustomer;
  function expandPage() {
    const ids = new Set<string>();
    const walk = (ns: SNode[]) => ns.forEach((n) => {
      if (canOpen(n)) ids.add(n.id);
      walk(n.children);
    });
    walk(pageNodes);
    const allOpen = Array.from(ids).every((id) => expanded.has(id));
    setExpanded(allOpen ? new Set() : ids);
  }
  const pageAllOpen = pageNodes.length > 0 && pageNodes.every((n) => !canOpen(n) || expanded.has(n.id));

  const total = useMemo(() => {
    const sum = (f: (g: RowM) => number) => custList.reduce((t, g) => t + f(withMetrics(g)), 0);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [custList, comparable, selMonths?.join(","), denMonths?.join(",")]);

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
    add("Branch", cBranch);
    add("Customer Type", cKa);
    add("Customer Name", cName);
    add("Customer Group", cGroup);
    add("PSS", cPss);
    add("Product", fProduct);
    add("Model unit", fModel);
    add("Price Type", cPrice);
    if (refYear !== null) parts.push(`Tahun acuan: ${refYear}${isYtd ? ` (Actual sampai ${ytdMonth})` : ""}`);
    if (search.trim()) parts.push(`Pencarian: ${search.trim()}`);
    return parts.join(" | ");
  }

  function cellText(r: RowM, c: ColDef, label = ""): string {
    if (c.key === "hier") return label || "-";
    const v = r[c.key as keyof RowM];
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
    if (exporting || custList.length === 0) return;
    setExporting(true);
    try {
      const ecols = cols.map((c) => ({ key: String(c.key), label: headLabel(c), width: c.width }));
      const num = (v: unknown, pct = false) => (typeof v === "number" ? (pct ? Math.round(v * 1000) / 10 : Math.round(v)) : "");
      const toRow = (r: Record<string, unknown>, label: string) => {
        const o: Record<string, string | number | null> = {};
        cols.forEach((c) => {
          const v = c.key === "hier" ? label : r[c.key as string];
          o[String(c.key)] = c.kind === "text" ? ((v as string) ?? "") : c.key === "market_share" ? (v === null ? "" : num(v, true)) : num(v);
        });
        return o;
      };
      // Semua level ditulis lengkap (seperti semua baris dibuka); indentasi menunjukkan level.
      const out: Record<string, string | number | null>[] = [];
      const pad = (d: number) => "    ".repeat(d);
      const walk = (ns: SNode[]) =>
        ns.forEach((n) => {
          out.push(toRow(n.agg as unknown as Record<string, unknown>, pad(n.depth) + n.label));
          if (n.children.length > 0) walk(n.children);
          else if (!lastIsCustomer)
            sortRows(n.custs.map((r) => ({ agg: withMetrics(r), label: r.cname }))).forEach((x) =>
              out.push(toRow(x.agg as unknown as Record<string, unknown>, pad(n.depth + 1) + x.label))
            );
        });
      walk(tree);
      const totalRow = toRow({ ...total }, "TOTAL");
      await exportSummaryTableToExcel(
        "Summary",
        ecols,
        out,
        totalRow,
        `${filterNote()}${filterNote() ? " | " : ""}Hierarchy: ${act.map((d) => SUM_LABELS[d]).join(" > ")}${lastIsCustomer ? "" : " > Customer"}`
      );
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
            <span className="detail-filters-info">{busy ? `Menghitung… ${Math.round(calcPct * 100)}%` : `${custList.length.toLocaleString("id-ID")} customer`}</span>
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
            info="Tahun perhitungan Market Size dan Actual Sales. UIO = unit yang masih dalam umur 10 tahun di tahun ini, yaitu Year BAST tahun ini − 9 sampai tahun ini (BAST = Berita Acara Serah Terima, yaitu dokumen saat unit diserahterimakan ke customer). Kosong = tahun terbaru yang punya data UIO."
          />
          <MultiSelectField
            label="Month"
            values={fBulan}
            options={state.options.bulan}
            onChange={wrap(setFBulan)}
            info="Kosong = /year (12 bulan). Market Size bulan terpilih = jumlah kebutuhan part bulan-bulan itu (jam operasi unit per bulan mengikuti hari kerja kalender, unit baru dihitung mulai Month BAST-nya). Market share bulan terpilih memakai Actual per bulan dari sinkron web Sales."
          />
          <MultiSelectField
            label="Branch"
            values={cBranch}
            options={groupOpts.branch}
            onChange={wrap(setCBranch)}
            info="Cabang customer: dari Master Customer, atau dari kolom Branch di Data UIO kalau Master Customer belum terisi. Customer yang punya unit di cabang terpilih ikut dihitung penuh."
          />
          <MultiSelectField
            label="Customer Type"
            values={cKa}
            options={groupOpts.ka}
            onChange={wrap(setCKa)}
            info="Customer Type (Key Account) dari laporan Actual Sales: KA Nasional, KA Branch Platinum/Gold, NKA, Dealer, SHN."
          />
          <MultiSelectField label="Customer Name" values={cName} options={groupOpts.name} onChange={wrap(setCName)} />
          <MultiSelectField label="Customer Group" values={cGroup} options={groupOpts.group} onChange={wrap(setCGroup)} />
          <MultiSelectField
            label="PSS"
            values={cPss}
            options={groupOpts.pss}
            onChange={wrap(setCPss)}
            info="PSS dari Master Customer, atau dari kolom Pss Name di Data UIO kalau Master Customer belum terisi."
          />
          <MultiSelectField label="Product" values={fProduct} options={productOpts} onChange={changeProduct} />
          <MultiSelectField label="Model unit" values={fModel} options={modelOpts} onChange={changeModel} />
          <MultiSelectField
            label="Price Type"
            values={cPrice}
            options={PRICE_OPTIONS}
            onChange={wrap(setCPrice)}
            info="Price Type customer dari kolom Price Type di Data UIO. Non-Kontrak = Harga Non Kontrak (harga tertera − 50%). Kontrak / SCPL = harga di Data Harga Kontrak / SCPL lewat Customer Code; part yang tidak ada di daftar kontrak memakai Harga Non Kontrak. Kalau Price Type belum diisi, dianggap Kontrak bila Customer Code-nya punya harga kontrak."
          />
        </div>
      </div>

      {/* BOX 2 — Tabel summary */}
      <div className="panel">
        <div className="panel-head">
          <h2>Summary</h2>
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
              disabled={pageNodes.length === 0}
              onClick={expandPage}
              title="Buka / tutup semua level di halaman ini"
            >
              {pageAllOpen ? "− Tutup semua" : "+ Buka semua"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={exporting || custList.length === 0}
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
        <div style={{ padding: "0 16px 12px" }}>
          <b style={{ fontSize: 12.5, letterSpacing: ".06em", textTransform: "uppercase" }}>Hierarchy Controls</b>
          <LevelPicker
            levels={levels}
            dims={SUM_DIMS}
            labels={SUM_LABELS}
            firstOptional
            onChange={(next) => {
              setLevels(next);
              setExpanded(new Set());
              setKidShow(new Map());
              setPage(1);
            }}
          />
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
              {visible.map((v) => {
                if (v.kind === "more") {
                  return (
                    <tr key={`${v.parent}>more`}>
                      <td colSpan={cols.length} style={{ paddingLeft: 8 + v.depth * 22 }}>
                        <button type="button" className="link-btn" onClick={() => setKidShow((p) => new Map(p).set(v.parent, (p.get(v.parent) ?? KID_CAP) + KID_CAP))}>
                          + {fmtInt(Math.min(KID_CAP, v.left))} baris lagi (dari {fmtInt(v.left)} sisa)
                        </button>
                      </td>
                    </tr>
                  );
                }
                if (v.kind === "cust") {
                  return (
                    <tr key={`${v.parent}>${v.r.id}`} style={{ background: "rgba(127,127,127,0.07)" }}>
                      {cols.map((c, i) => (
                        <td key={String(c.key)} className={c.kind === "computed" ? "computed" : undefined}>
                          {i === 0 ? (
                            <span style={{ paddingLeft: 8 + v.depth * 22, color: "var(--ink-mute)" }}>↳ {v.r.cname}</span>
                          ) : (
                            cellText(v.r, c)
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                }
                const n = v.n;
                const open = expanded.has(n.id);
                const openable = canOpen(n);
                return (
                  <tr key={n.id} style={n.depth === 0 ? { fontWeight: 600 } : n.depth > 0 ? { background: `rgba(127,127,127,${Math.min(0.03 * n.depth, 0.09)})` } : undefined}>
                    {cols.map((c, i) => (
                      <td key={String(c.key)} className={c.kind === "computed" ? "computed" : undefined}>
                        {i === 0 ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, paddingLeft: n.depth * 22 }} title={`${SUM_LABELS[n.dim]}: ${n.label}`}>
                            {openable ? (
                              <button
                                type="button"
                                onClick={() => toggleNode(n.id)}
                                aria-expanded={open}
                                aria-label={open ? "Tutup" : "Buka"}
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
                            ) : (
                              <span style={{ width: 22, flex: "none" }} />
                            )}
                            {n.label}
                          </span>
                        ) : (
                          cellText(n.agg, c)
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {custList.length > 0 && (
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
              {custList.length === 0 && !busy && (
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
            Halaman {currentPage} / {pages} · {tree.length.toLocaleString("id-ID")} {act[0] ? SUM_LABELS[act[0]] : "baris"}
          </span>
          <button disabled={currentPage >= pages} onClick={() => setPage((p) => p + 1)}>
            Berikutnya ›
          </button>
        </div>
      </div>
    </>
  );
}
