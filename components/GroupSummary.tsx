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
  uniq,
  type GroupRow
} from "@/lib/calculations";
import { MultiSelectField } from "@/components/FilterBar";
import { exportSummaryTableToExcel } from "@/lib/exportDetail";

const PAGE_SIZE = 20;

/** Satu baris tabel: metrik dari GroupRow + label sesuai tingkat baris. */
type Row = GroupRow & { id: string; code: string; name: string; grp: string; ctype: string; ktier: string };
type SortKey = keyof Row;
type ColDef = { key: SortKey; label: string; kind: "text" | "num" | "computed"; width?: number };

const METRIC_COLS: ColDef[] = [
  { key: "uio", label: "UIO (unit)", kind: "num", width: 12 },
  { key: "qty_market_size", label: "Qty market size", kind: "computed", width: 16 },
  { key: "amount_market_size", label: "Market Size (Rp)", kind: "computed", width: 20 },
  { key: "amount_period", label: "Market Size/m (Rp)", kind: "computed", width: 24 },
  { key: "actual_qty", label: "Actual qty", kind: "num", width: 12 },
  { key: "actual_sales", label: "Actual sales (Rp)", kind: "num", width: 20 },
  { key: "market_share", label: "Market share", kind: "computed", width: 14 }
];
const LABEL_COLS: ColDef[] = [
  { key: "code", label: "Cust. Code", kind: "text", width: 14 },
  { key: "name", label: "Cust. Name", kind: "text", width: 32 },
  { key: "grp", label: "Cust. Group", kind: "text", width: 24 },
  { key: "ctype", label: "Cust. Type", kind: "text", width: 18 },
  { key: "ktier", label: "KA Tier", kind: "text", width: 20 }
];

/** Tab Summary: dua box terpisah — (1) Filter, (2) Summary per Customer.
 * Filter di sini berdiri sendiri (tidak ikut filter di page Dashboard). */
export default function GroupSummary({ state }: { state: UseDashboardState }) {
  const { data } = state;
  const customers = state.realCustomers;
  type Cust = (typeof customers)[number];

  // ---- state filter lokal ----
  const [fTahun, setFTahun] = useState<string[]>([]);
  const [fBulan, setFBulan] = useState<string[]>([]);
  const [fProduct, setFProduct] = useState<string[]>([]);
  const [fModel, setFModel] = useState<string[]>([]);
  const [fPartName, setFPartName] = useState<string[]>([]);
  const [cCode, setCCode] = useState<string[]>([]);
  const [cName, setCName] = useState<string[]>([]);
  const [cGroup, setCGroup] = useState<string[]>([]);
  const [cType, setCType] = useState<string[]>([]); // Customer Type (dari kolom Cust. Type di Data UIO)
  const [cTier, setCTier] = useState<string[]>([]); // KA Tier (DEALER, KA BRANCH GOLD, KA NASIONAL, dst)

  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<SortKey>("amount_market_size");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  // ---- pilihan filter (saling mengikuti) ----
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

  // Customer Type berasal dari kolom "Cust. Type" di Data UIO (per unit), dipetakan ke customer lewat Group + Name.
  const typesByKey = useMemo(() => {
    const m = new Map<string, Set<string>>();
    data.uioUnits.forEach((u) => {
      const t = (u.customer_type || "").trim();
      if (!t) return;
      const k = custKey(u.customer_group, u.customer_name);
      let set = m.get(k);
      if (!set) m.set(k, (set = new Set()));
      set.add(t);
    });
    return m;
  }, [data.uioUnits]);
  const typesOf = (c: Cust) => Array.from(typesByKey.get(custKey(c.customer_group, c.customer_name)) || []);

  type CKey = "code" | "name" | "group" | "type" | "tier";
  const customerOpts = useMemo(() => {
    const sel = { code: new Set(cCode), name: new Set(cName), group: new Set(cGroup), type: new Set(cType), tier: new Set(cTier) };
    const ok = (c: Cust, skip: CKey) =>
      (skip === "code" || sel.code.size === 0 || sel.code.has(c.customer_code || "")) &&
      (skip === "name" || sel.name.size === 0 || sel.name.has(c.customer_name || "")) &&
      (skip === "group" || sel.group.size === 0 || sel.group.has(c.customer_group || "")) &&
      (skip === "type" || sel.type.size === 0 || typesOf(c).some((t) => sel.type.has(t))) &&
      (skip === "tier" || sel.tier.size === 0 || sel.tier.has(c.tier || ""));
    const list = (skip: CKey, pick: (c: Cust) => (string | null)[]) =>
      uniq(customers.filter((c) => ok(c, skip)).flatMap(pick)).sort();
    return {
      code: list("code", (c) => [c.customer_code]),
      name: list("name", (c) => [c.customer_name]),
      group: list("group", (c) => [c.customer_group]),
      type: list("type", (c) => typesOf(c)),
      tier: list("tier", (c) => [c.tier])
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, typesByKey, cCode, cName, cGroup, cType, cTier]);

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
    fTahun.length + fBulan.length + fProduct.length + fModel.length + fPartName.length + cCode.length + cName.length + cGroup.length + cType.length + cTier.length > 0;

  function resetAll() {
    [setFTahun, setFBulan, setFProduct, setFModel, setFPartName, setCCode, setCName, setCGroup, setCType, setCTier].forEach((s) => s([]));
    setSearch("");
    setPage(1);
  }

  // Filter yang dipakai untuk menghitung: HANYA yang ada di box filter ini.
  const calcFilters = useMemo(
    () => ({ ...EMPTY_FILTERS, tahun: fTahun, bulan: fBulan, product: fProduct, modelUnit: fModel, partName: fPartName }),
    [fTahun, fBulan, fProduct, fModel, fPartName]
  );
  const monthsSelected = fBulan.length > 0 ? new Set(fBulan).size : 12;

  // ---- hitung sesuai tingkat baris (bertahap supaya halaman tetap responsif) ----
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const sel = { code: new Set(cCode), name: new Set(cName), group: new Set(cGroup), type: new Set(cType), tier: new Set(cTier) };
        const selected = customers.filter(
      (c) =>
        (sel.code.size === 0 || sel.code.has(c.customer_code || "")) &&
        (sel.name.size === 0 || sel.name.has(c.customer_name || "")) &&
        (sel.group.size === 0 || sel.group.has(c.customer_group || "")) &&
        (sel.type.size === 0 || typesOf(c).some((t) => sel.type.has(t))) &&
        (sel.tier.size === 0 || sel.tier.has(c.tier || ""))
    );
    const blank = { code: "", name: "", grp: "", ctype: "", ktier: "" };
    const mk = (id: string, label: string, n: number, g: GroupRow, extra: Partial<typeof blank>): Row => ({
      ...g,
      group: label,
      customers: n,
      id,
      ...blank,
      ...extra
    });
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    // ---- Satu baris per customer (dicicil supaya halaman tetap responsif) ----
    type Task = { id: string; label: string; keys: Set<string>; extra: Partial<typeof blank>; priceGroup: string };
    const tasks: Task[] = [];
    selected.forEach((c) => {
      const k = custKey(c.customer_group, c.customer_name);
      tasks.push({
        id: k,
        label: c.customer_name || "",
        keys: new Set([k]),
        extra: { code: c.customer_code || "", name: c.customer_name || "", grp: c.customer_group || "", ctype: typesOf(c).join(", "), ktier: c.tier || "" },
        priceGroup: c.customer_group || ""
      });
    });
    // Pisahkan unit & transaksi per entitas SEKALI.
    const taskOfKey = new Map<string, string>();
    tasks.forEach((t) => t.keys.forEach((k) => taskOfKey.set(k, t.id)));
    const unitsBy = new Map<string, typeof data.uioUnits>();
    data.uioUnits.forEach((u) => {
      const id = taskOfKey.get(custKey(u.customer_group, u.customer_name));
      if (id === undefined) return;
      const a = unitsBy.get(id);
      if (a) a.push(u);
      else unitsBy.set(id, [u]);
    });
    const txBy = new Map<string, typeof data.actualSalesTx>();
    data.actualSalesTx.forEach((r) => {
      const id = taskOfKey.get(custKey(r.customer_group, r.customer_name));
      if (id === undefined) return;
      const a = txBy.get(id);
      if (a) a.push(r);
      else txBy.set(id, [r]);
    });
    const ctx = prepareDetailCtx(data.parts, data.uioUnits, data.priceList, data.actualSalesTx, calcFilters);

    const out: Row[] = [];
    let i = 0;
    setBusy(true);
    const step = () => {
      if (cancelled) return;
      const t0 = performance.now();
      while (i < tasks.length && performance.now() - t0 < 12) {
        const t = tasks[i++];
        const gu = unitsBy.get(t.id) || [];
        const gt = txBy.get(t.id) || [];
        if (gu.length === 0 && gt.length === 0) continue;
        const list = buildDetailRows(data.parts, data.assumptions, data.uioUnits, data.priceList, data.customers, data.actualSalesTx, calcFilters, t.keys, {
          units: gu,
          tx: gt,
          priceGroup: t.priceGroup,
          ctx
        });
        const agg = aggregateGroup(t.label, t.keys.size, list);
        if (agg.uio > 0 || agg.actual_sales > 0 || agg.amount_market_size > 0) out.push(mk(t.id, t.label, t.keys.size, agg, t.extra));
      }
      if (i < tasks.length) timers.push(setTimeout(step, 0));
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
  }, [customers, typesByKey, cCode, cName, cGroup, cType, cTier, data, calcFilters]);

  const cols: ColDef[] = useMemo(() => [...LABEL_COLS, ...METRIC_COLS], []);
  const textKeys = useMemo(() => cols.filter((c) => c.kind === "text").map((c) => c.key), [cols]);

  // Market Size/m = (Market Size / 12) x jumlah bulan terpilih (12 bulan kalau filter Bulan kosong).
  const rowsM = useMemo(
    () => rows.map((r) => ({ ...r, amount_period: (r.amount_market_size / 12) * monthsSelected })),
    [rows, monthsSelected]
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
    const sum = (f: (g: Row) => number) => sorted.reduce((t, g) => t + f(g), 0);
    const pm = sum((g) => g.period_market);
    return {
      customers: sum((g) => g.customers),
      uio: sum((g) => g.uio),
      qty_market_size: sum((g) => g.qty_market_size),
      amount_market_size: sum((g) => g.amount_market_size),
      amount_period: sum((g) => g.amount_period),
      actual_qty: sum((g) => g.actual_qty),
      actual_sales: sum((g) => g.actual_sales),
      market_share: pm > 0 ? sum((g) => g.actual_sales) / pm : null
    } as Record<string, number | null>;
  }, [sorted]);

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
    add("Customer Code", cCode);
    add("Customer Name", cName);
    add("Customer Group", cGroup);
    add("Customer Type", cType);
    add("KA Tier", cTier);
    if (search.trim()) parts.push(`Pencarian: ${search.trim()}`);
    return parts.join(" | ");
  }

  function cellText(r: Row, c: ColDef): string {
    const v = r[c.key];
    if (c.key === "market_share") return fmtPct(r.market_share);
    if (c.key === "amount_market_size" || c.key === "amount_period" || c.key === "actual_sales") return fmtIDRFull(v as number);
    if (c.kind === "text") return (v as string) || "-";
    return fmtInt(v as number);
  }

  async function onExport() {
    if (exporting || sorted.length === 0) return;
    setExporting(true);
    try {
      const periodLabel = `Market Size/m (${monthsSelected} bln) (Rp)`;
      const ecols = cols.map((c) => ({ key: String(c.key), label: c.key === "amount_period" ? periodLabel : c.label, width: c.width }));
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
      await exportSummaryTableToExcel("Customer", ecols, sorted.map((r) => toRow(r as unknown as Record<string, unknown>)), totalRow, filterNote());
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
            options={state.options.tahun}
            onChange={wrap(setFTahun)}
            info="Kosong = tahun terbaru yang punya data."
          />
          <MultiSelectField
            label="Bulan"
            values={fBulan}
            options={state.options.bulan}
            onChange={wrap(setFBulan)}
            info="Kosong = 12 bulan. Market Size/m = (Market Size / 12) × jumlah bulan yang dipilih."
          />
          <MultiSelectField label="Product" values={fProduct} options={productOpts} onChange={changeProduct} />
          <MultiSelectField label="Model unit" values={fModel} options={modelOpts} onChange={changeModel} />
          <MultiSelectField label="Part name" values={fPartName} options={partNameOpts} onChange={wrap(setFPartName)} />
          <MultiSelectField label="Customer Code" values={cCode} options={customerOpts.code} onChange={wrap(setCCode)} />
          <MultiSelectField label="Customer Name" values={cName} options={customerOpts.name} onChange={wrap(setCName)} />
          <MultiSelectField label="Customer Group" values={cGroup} options={customerOpts.group} onChange={wrap(setCGroup)} />
          <MultiSelectField
            label="Customer Type"
            values={cType}
            options={customerOpts.type}
            onChange={wrap(setCType)}
            info="Jenis customer dari kolom Cust. Type di Data UIO. Pilihan baru muncul setelah Data UIO di-upload dengan format terbaru."
          />
          <MultiSelectField
            label="KA Tier"
            values={cTier}
            options={customerOpts.tier}
            onChange={wrap(setCTier)}
            info="Klasifikasi key account customer (KA Nasional, KA Branch Platinum/Gold, NKA, Dealer, SHN, dst)."
          />
        </div>
      </div>

      {/* BOX 2 — Tabel summary */}
      <div className="panel">
        <div className="panel-head">
          <h2>Summary per Customer</h2>
          <div className="panel-tools">
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
              placeholder="Cari customer…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={String(c.key)} onClick={() => onSort(c.key)} style={{ cursor: "pointer" }} className={c.kind === "computed" ? "computed" : undefined}>
                    {c.key === "amount_period" ? `Market Size/m (${monthsSelected} bln) (Rp)` : c.label}
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
