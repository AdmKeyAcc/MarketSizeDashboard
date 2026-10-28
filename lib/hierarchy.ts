import {
  EMPTY_FILTERS,
  buildPriceResolver,
  canonicalProduct,
  addUnitHm,
  computePartMarketSize,
  custKey,
  emptyUnitHm,
  defaultWorkdaysOf,
  mergeUnitHm,
  partAnnualHm,
  type UnitHm,
  type WorkdaysOf,
  normModel,
  type FilterState,
  type MarketSizeYearRow
} from "@/lib/calculations";
import type { ActualSalesYear, Customer, Part, PriceListEntry, UioUnit } from "@/lib/types";
import { kaRank } from "@/lib/references";

/* ------------------------------------------------------------------ */
/* Dimensi hierarki                                                    */
/* ------------------------------------------------------------------ */

export const HIER_DIMS = ["kaType", "group", "customer", "area", "pss", "product", "model"] as const;
export type HierDim = (typeof HIER_DIMS)[number];

export const HIER_LABELS: Record<HierDim, string> = {
  kaType: "KA Type",
  group: "Customer Group",
  customer: "Customer Name",
  area: "Branch",
  pss: "PSS",
  product: "Product",
  model: "Model Unit"
};

/** Dimensi yang melekat pada customer. Actual Sales (laporan per customer) hanya bisa
 * ditampilkan di level yang seluruh jalurnya terdiri dari dimensi seperti ini. */
export const CUSTOMER_DIMS: HierDim[] = ["kaType", "group", "customer", "area", "pss"];
/** Actual Sales juga bisa ditampilkan per Product (laporan Actual per Product), tapi tidak per Model. */
export const isActualDim = (d: HierDim) => d === "product" || CUSTOMER_DIMS.includes(d);
export const isCustomerDim = (d: HierDim) => CUSTOMER_DIMS.includes(d);

const NO_GROUP = "(Tanpa Group)";
const NO_KA = "(Tanpa KA Type)";
const NO_AREA = "(Tanpa Area)";
const NO_PSS = "(Tanpa PSS)";

/* ------------------------------------------------------------------ */
/* Customer & fakta Market Size                                        */
/* ------------------------------------------------------------------ */

export type CustInfo = {
  key: string;
  group: string;
  name: string;
  ka: string;
  area: string;
  pss: string;
  /** Actual Sales per tahun (Rp), dari laporan tahunan. */
  actual: Map<number, number>;
  /** Actual Sales per Product (canonical; "" = laporan tanpa Product) lalu per tahun. */
  actualByProduct: Map<string, Map<number, number>>;
  units: UioUnit[];
  /** Ejaan Customer Group di Data Harga (harga kontrak) kalau group ini punya harga kontrak. */
  priceGroup: string;
};

/** Satu baris fakta = Market Size satu customer untuk satu Product + Model pada tahun acuan (setahun penuh). */
export type Fact = { product: string; model: string; ms: number; qty: number; uio: number };

const tierRank = (t: string) => kaRank(t);
export const byKaOrder = (a: string, b: string) => tierRank(a) - tierRank(b) || a.localeCompare(b);

/** Gabungan customer dari Master Customer, Data UIO dan laporan Actual Sales (dicocokkan lewat custKey = GROUP|NAMA). */
export function buildCustomerIndex(
  customers: Customer[],
  uioUnits: UioUnit[],
  actualYear: ActualSalesYear[],
  priceList: PriceListEntry[]
): CustInfo[] {
  const m = new Map<string, CustInfo>();
  const kaAmount = new Map<string, Map<string, number>>();
  const contractNames = new Map<string, string>();
  priceList.forEach((p) => {
    if (p.price_type === "contract" && p.customer_group) contractNames.set(p.customer_group.trim().toUpperCase(), p.customer_group);
  });
  const get = (group: string | null, name: string | null): CustInfo | null => {
    const nm = (name || "").trim();
    if (!nm) return null;
    const key = custKey(group, nm);
    let c = m.get(key);
    if (!c) {
      const g = (group || "").trim();
      c = { key, group: g, name: nm, ka: "", area: "", pss: "", actual: new Map(), actualByProduct: new Map(), units: [], priceGroup: contractNames.get(g.toUpperCase()) || "" };
      m.set(key, c);
    }
    return c;
  };
  const master = new Map<string, Customer>();
  customers.forEach((cu) => {
    const c = get(cu.customer_group, cu.customer_name);
    if (!c) return;
    master.set(c.key, cu);
    c.area = (cu.cabang || "").trim();
    c.pss = (cu.pss || "").trim();
    c.ka = (cu.tier || "").trim().toUpperCase();
  });
  uioUnits.forEach((u) => {
    const c = get(u.customer_group, u.customer_name);
    if (!c) return;
    c.units.push(u);
    if (!c.area && u.branch) c.area = u.branch.trim();
    if (!c.pss && u.pss_name) c.pss = u.pss_name.trim();
  });
  actualYear.forEach((r) => {
    const c = get(r.customer_group, r.customer_name);
    if (!c) return;
    c.actual.set(r.year, (c.actual.get(r.year) || 0) + r.amount);
    const pk = canonicalProduct(r.product);
    let bp = c.actualByProduct.get(pk);
    if (!bp) c.actualByProduct.set(pk, (bp = new Map()));
    bp.set(r.year, (bp.get(r.year) || 0) + r.amount);
    if (r.ka_type) {
      let k = kaAmount.get(c.key);
      if (!k) kaAmount.set(c.key, (k = new Map()));
      k.set(r.ka_type, (k.get(r.ka_type) || 0) + Math.abs(r.amount));
    }
  });
  m.forEach((c) => {
    // KA Type: dari laporan Actual Sales (yang terbesar kalau satu customer muncul di dua KA Type), selain itu dari Master Customer.
    const k = kaAmount.get(c.key);
    if (k && k.size > 0) c.ka = Array.from(k.entries()).sort((a, b) => b[1] - a[1])[0][0].toUpperCase();
    if (!c.ka) c.ka = NO_KA;
    if (!c.area) c.area = NO_AREA;
    if (!c.pss) c.pss = NO_PSS;
    if (!c.group) c.group = NO_GROUP;
  });
  return Array.from(m.values());
}

type PartIndex = Map<string, Map<string, Part[]>>;

/** product (kanonik) → model part (dinormalisasi) → daftar part. */
export function indexParts(parts: Part[]): PartIndex {
  const idx: PartIndex = new Map();
  parts.forEach((p) => {
    const pk = canonicalProduct(p.product);
    let byModel = idx.get(pk);
    if (!byModel) idx.set(pk, (byModel = new Map()));
    const mk = normModel(p.model);
    const arr = byModel.get(mk);
    if (arr) arr.push(p);
    else byModel.set(mk, [p]);
  });
  return idx;
}

export type FactDeps = {
  partIndex: PartIndex;
  workdaysOf: WorkdaysOf;
  priceOf: ReturnType<typeof buildPriceResolver>;
  year: number;
  /** Hanya filter Product/Model/Part Number/Part Name yang dipakai di sini. */
  filters: FilterState;
};

export function makeFactDeps(parts: Part[], priceList: PriceListEntry[], year: number, filters: FilterState): FactDeps {
  return { partIndex: indexParts(parts), workdaysOf: defaultWorkdaysOf, priceOf: buildPriceResolver(priceList), year, filters };
}

/** Market Size setahun satu customer per Product + Model, dengan rumus yang sama seperti Detail part di page Summary:
 * UIO = unit customer itu sampai tahun acuan (cocok Product + Model; model part boleh berupa awalan model unit),
 * Qty = ROUND(Annual HM ÷ Frekuensi × Qty/unit × UIO), Rp = Harga × Qty (harga kontrak kalau group-nya punya).
 * Annual HM = rata-rata jam operasi unit-unit itu (HM/Day × Day/Month × Month/Year di Data UIO). */
export function computeCustomerFacts(c: CustInfo, d: FactDeps): Fact[] {
  if (c.units.length === 0) return [];
  const f = d.filters;
  const prodSet = f.product.length > 0 ? new Set(f.product) : null;
  const modelSet = f.modelUnit.length > 0 ? new Set(f.modelUnit) : null;
  const pnSet = f.partNumber.length > 0 ? new Set(f.partNumber) : null;
  const nameSet = f.partName.length > 0 ? new Set(f.partName) : null;

  // jumlah unit + jam operasi per product → model (dinormalisasi)
  const counts = new Map<string, Map<string, UnitHm>>();
  c.units.forEach((u) => {
    if (u.year !== null && u.year > d.year) return;
    const pk = canonicalProduct(u.product);
    let m = counts.get(pk);
    if (!m) counts.set(pk, (m = new Map()));
    const nm = normModel(u.model);
    let agg = m.get(nm);
    if (!agg) m.set(nm, (agg = emptyUnitHm()));
    addUnitHm(agg, u, d.workdaysOf, d.year);
  });

  const out = new Map<string, Fact>();
  counts.forEach((unitModels, pk) => {
    const byModel = d.partIndex.get(pk);
    if (!byModel) return;
    byModel.forEach((plist, pm) => {
      let hrs = unitModels.get(pm);
      if ((!hrs || hrs.units === 0) && pm.length >= 3) {
        const sum = emptyUnitHm();
        unitModels.forEach((a, k) => { if (k.startsWith(pm)) mergeUnitHm(sum, a); });
        hrs = sum;
      }
      const uio = hrs?.units || 0;
      if (uio === 0) return;
      plist.forEach((p) => {
        if (prodSet && !prodSet.has(p.product)) return;
        if (modelSet && !modelSet.has(p.model)) return;
        if (pnSet && !pnSet.has(p.part_number || "")) return;
        if (nameSet && !nameSet.has(p.part_name || "")) return;
        const { annualHm } = partAnnualHm(hrs, p.hm_day, p.product, d.workdaysOf);
        const price = d.priceOf(p.part_number, c.priceGroup || c.group, p.pricelist);
        const { qty, amount } = computePartMarketSize({ annualHm, freqReplacementHm: p.freq_replacement_hm, qtyPerUnit: p.qty_per_unit, uio, price });
        const k = `${p.product}|${p.model}`;
        const e = out.get(k);
        if (e) {
          e.ms += amount;
          e.qty += qty;
        } else out.set(k, { product: p.product, model: p.model, ms: amount, qty, uio });
      });
    });
  });
  return Array.from(out.values());
}

/* ------------------------------------------------------------------ */
/* Pohon hierarki                                                      */
/* ------------------------------------------------------------------ */

export type TreeNode = {
  id: string;
  label: string;
  dim: HierDim;
  depth: number;
  ms: number;
  qty: number;
  uio: number;
  /** null = Actual Sales tidak bisa ditampilkan di level ini. */
  actual: number | null;
  canActual: boolean;
  children: TreeNode[];
};

/** Filter global (bagian customer) diterapkan ke customer. */
export function customerPasses(c: CustInfo, f: FilterState): boolean {
  const up = (a: string[]) => new Set(a.map((x) => x.trim().toUpperCase()));
  if (f.customerGroup.length > 0 && !up(f.customerGroup).has(c.group.toUpperCase()) && !(c.group === NO_GROUP && up(f.customerGroup).has(""))) return false;
  if (f.customerName.length > 0 && !up(f.customerName).has(c.name.toUpperCase())) return false;
  if (f.area.length > 0 && !up(f.area).has(c.area.toUpperCase())) return false;
  if (f.pss.length > 0 && !up(f.pss).has(c.pss.toUpperCase())) return false;
  if (f.tier.length > 0 && !up(f.tier).has(c.ka.toUpperCase())) return false;
  return true;
}

function dimValue(dim: HierDim, c: CustInfo, fact?: Fact): string {
  switch (dim) {
    case "kaType": return c.ka;
    case "group": return c.group;
    case "customer": return c.name;
    case "area": return c.area;
    case "pss": return c.pss;
    case "product": return fact?.product || "-";
    case "model": return fact?.model || "-";
  }
}

export type TreeResult = {
  roots: TreeNode[];
  totalMs: number;
  totalQty: number;
  totalUio: number;
  totalActual: number | null;
  customers: number;
};

/** Bangun pohon: Market Size (dan qty/UIO) dari fakta, Actual dari customer.
 * `factor` = bagian tahun yang dibandingkan (mis. Jan–Agu = 0,66); `actualOk` false → semua Actual "-". */
export function buildTree(
  custs: CustInfo[],
  factsOf: (key: string) => Fact[] | undefined,
  levels: HierDim[],
  filters: FilterState,
  year: number,
  factor: number,
  actualOk: boolean
): TreeResult {
  const roots = new Map<string, TreeNode>();
  const nodeOf = (store: Map<string, TreeNode>, parent: TreeNode | null, dim: HierDim, label: string, depth: number): TreeNode => {
    const id = (parent ? parent.id + "¦" : "") + dim + ":" + label;
    let n = store.get(id);
    if (!n) {
      const canActual = actualOk && (parent ? parent.canActual : true) && isActualDim(dim);
      n = { id, label, dim, depth, ms: 0, qty: 0, uio: 0, actual: canActual ? 0 : null, canActual, children: [] };
      store.set(id, n);
      if (parent) parent.children.push(n);
    }
    return n;
  };
  const all = new Map<string, TreeNode>();
  const prodSet = filters.product.length > 0 ? new Set(filters.product.map((p) => canonicalProduct(p))) : null;
  let totalMs = 0, totalQty = 0, totalUio = 0, totalActual = 0, nCust = 0;

  custs.forEach((c) => {
    if (!customerPasses(c, filters)) return;
    const facts = factsOf(c.key) || [];
    // Actual customer ini per Product (hanya Product yang dipilih di filter kalau ada).
    const actualParts: [string, number][] = [];
    let actual = 0;
    if (actualOk) {
      c.actualByProduct.forEach((byYear, pk) => {
        if (prodSet && !prodSet.has(pk)) return;
        const v = byYear.get(year) || 0;
        if (v === 0) return;
        actualParts.push([pk, v]);
        actual += v;
      });
    }
    if (facts.length === 0 && actual === 0) return;
    nCust++;
    totalActual += actual;

    facts.forEach((fa) => {
      const ms = fa.ms * factor;
      const qty = fa.qty * factor;
      totalMs += ms; totalQty += qty; totalUio += fa.uio;
      let parent: TreeNode | null = null;
      levels.forEach((dim, i) => {
        const n = nodeOf(all, parent, dim, dimValue(dim, c, fa), i);
        n.ms += ms; n.qty += qty; n.uio += fa.uio;
        if (!parent) roots.set(n.id, n);
        parent = n;
      });
    });
    actualParts.forEach(([pk, amount]) => {
      let parent: TreeNode | null = null;
      for (let i = 0; i < levels.length; i++) {
        const dim = levels[i];
        if (!isActualDim(dim)) break;
        const n = nodeOf(all, parent, dim, dimValue(dim, c, pk ? { product: pk, model: "", ms: 0, qty: 0, uio: 0 } : undefined), i);
        n.actual = (n.actual || 0) + amount;
        if (!parent) roots.set(n.id, n);
        parent = n;
      }
    });
  });
  return {
    roots: Array.from(roots.values()),
    totalMs,
    totalQty,
    totalUio,
    totalActual: actualOk ? totalActual : null,
    customers: nCust
  };
}

export type SortKey = "name" | "ms" | "actual";

export function sortTree<T extends { label: string; ms: number; actual: number | null }>(nodes: T[], key: SortKey, dir: "asc" | "desc"): T[] {
  const mul = dir === "asc" ? 1 : -1;
  const val = (n: T) => (key === "ms" ? n.ms : key === "actual" ? n.actual ?? -Infinity : 0);
  const sorted = nodes.slice().sort((a, b) => {
    if (key === "name") return mul * a.label.localeCompare(b.label, "id");
    return mul * (val(a) - val(b)) || a.label.localeCompare(b.label, "id");
  });
  return sorted;
}

/* ------------------------------------------------------------------ */
/* Beberapa tahun berdampingan                                         */
/* ------------------------------------------------------------------ */

export type YearVals = { ms: number; qty: number; uio: number; actual: number | null };
export type TreeNodeM = Omit<TreeNode, "children"> & {
  children: TreeNodeM[];
  /** Nilai tiap tahun. Field ms / actual / uio di node = tahun acuan (terbaru). */
  yr: Record<number, YearVals>;
};
export type TreeResultM = {
  roots: TreeNodeM[];
  years: number[];
  mainYear: number;
  totals: Record<number, YearVals>;
  customers: number;
};

/** Gabungkan pohon beberapa tahun (struktur sama, nilai per tahun) jadi satu pohon: tiap node membawa nilai semua tahun. */
export function mergeYearTrees(items: { year: number; tree: TreeResult; actualOk: boolean }[], mainYear: number): TreeResultM {
  const byId = new Map<string, TreeNodeM>();
  const roots = new Map<string, TreeNodeM>();
  const totals: Record<number, YearVals> = {};
  let customers = 0;
  items.forEach(({ year, tree }) => {
    totals[year] = { ms: tree.totalMs, qty: tree.totalQty, uio: tree.totalUio, actual: tree.totalActual };
    customers = Math.max(customers, tree.customers);
    const visit = (n: TreeNode, parent: TreeNodeM | null) => {
      let m = byId.get(n.id);
      if (!m) {
        m = { id: n.id, label: n.label, dim: n.dim, depth: n.depth, ms: 0, qty: 0, uio: 0, actual: n.canActual ? 0 : null, canActual: n.canActual, children: [], yr: {} };
        byId.set(n.id, m);
        if (parent) parent.children.push(m);
        else roots.set(m.id, m);
      }
      if (n.canActual) m.canActual = true;
      m.yr[year] = { ms: n.ms, qty: n.qty, uio: n.uio, actual: n.actual };
      if (year === mainYear) {
        m.ms = n.ms; m.qty = n.qty; m.uio = n.uio; m.actual = n.actual;
      }
      n.children.forEach((ch) => visit(ch, m));
    };
    tree.roots.forEach((r) => visit(r, null));
  });
  byId.forEach((m) => {
    items.forEach(({ year, actualOk }) => {
      if (!m.yr[year]) m.yr[year] = { ms: 0, qty: 0, uio: 0, actual: actualOk && m.canActual ? 0 : null };
    });
    const mv = m.yr[mainYear];
    if (mv) { m.ms = mv.ms; m.qty = mv.qty; m.uio = mv.uio; m.actual = mv.actual; }
  });
  return { roots: Array.from(roots.values()), years: items.map((i) => i.year), mainYear, totals, customers };
}

/** Baris Market Size per tahun (untuk chart & KPI) dari mesin hitung yang sama dengan tabel hierarki,
 * jadi semua filter (Branch, PSS, KA Type, Group, Customer, Product, Model, Part, ...) berlaku sama di tabel dan chart. */
export function marketRowsFromFacts(
  custs: CustInfo[],
  factsByYear: Map<number, Map<string, Fact[]>>,
  years: number[],
  filters: FilterState,
  opts: { factorOf: (year: number) => number; monthsOf: (year: number) => number; actualComparable: boolean }
): MarketSizeYearRow[] {
  const prodSet = filters.product.length > 0 ? new Set(filters.product.map((p) => canonicalProduct(p))) : null;
  const passed = custs.filter((c) => customerPasses(c, filters));
  return years.map((year) => {
    const facts = factsByYear.get(year);
    const factor = opts.factorOf(year);
    let ms = 0, qty = 0, actual = 0;
    passed.forEach((c) => {
      (facts?.get(c.key) || []).forEach((f) => {
        ms += f.ms * factor;
        qty += f.qty * factor;
      });
      if (opts.actualComparable) {
        c.actualByProduct.forEach((byYear, pk) => {
          if (prodSet && !prodSet.has(pk)) return;
          actual += byYear.get(year) || 0;
        });
      }
    });
    return {
      year,
      market_size: Math.round(ms),
      market_qty: Math.round(qty),
      actual_sales: Math.round(actual),
      actual_qty: 0,
      period_months: opts.monthsOf(year),
      actual_comparable: opts.actualComparable
    };
  });
}

export { EMPTY_FILTERS };
