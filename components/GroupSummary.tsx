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
  uniq,
  type GroupRow
} from "@/lib/calculations";
import { MultiSelectField } from "@/components/FilterBar";
import { exportGroupToExcel } from "@/lib/exportDetail";

const PAGE_SIZE = 20;

type SortKey = keyof GroupRow;

/** Tab Summary: dua box terpisah — (1) Filter, (2) Summary per Customer Group.
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
  const [cType, setCType] = useState<string[]>([]);

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

  type CKey = "code" | "name" | "group" | "type";
  const customerOpts = useMemo(() => {
    const sel = { code: new Set(cCode), name: new Set(cName), group: new Set(cGroup), type: new Set(cType) };
    const ok = (c: Cust, skip: CKey) =>
      (skip === "code" || sel.code.size === 0 || sel.code.has(c.customer_code || "")) &&
      (skip === "name" || sel.name.size === 0 || sel.name.has(c.customer_name || "")) &&
      (skip === "group" || sel.group.size === 0 || sel.group.has(c.customer_group || "")) &&
      (skip === "type" || sel.type.size === 0 || sel.type.has(c.tier || ""));
    const list = (skip: CKey, pick: (c: Cust) => string | null) => uniq(customers.filter((c) => ok(c, skip)).map(pick)).sort();
    return {
      code: list("code", (c) => c.customer_code),
      name: list("name", (c) => c.customer_name),
      group: list("group", (c) => c.customer_group),
      type: list("type", (c) => c.tier)
    };
  }, [customers, cCode, cName, cGroup, cType]);

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
    fTahun.length + fBulan.length + fProduct.length + fModel.length + fPartName.length + cCode.length + cName.length + cGroup.length + cType.length > 0;

  function resetAll() {
    [setFTahun, setFBulan, setFProduct, setFModel, setFPartName, setCCode, setCName, setCGroup, setCType].forEach((s) => s([]));
    setSearch("");
    setPage(1);
  }

  // Filter yang dipakai untuk menghitung: HANYA yang ada di box filter ini.
  const calcFilters = useMemo(
    () => ({ ...EMPTY_FILTERS, tahun: fTahun, bulan: fBulan, product: fProduct, modelUnit: fModel, partName: fPartName }),
    [fTahun, fBulan, fProduct, fModel, fPartName]
  );
  const monthsSelected = fBulan.length > 0 ? new Set(fBulan).size : 12;

  // ---- hitung per Customer Group (bertahap supaya halaman tetap responsif) ----
  const [groupRows, setGroupRows] = useState<GroupRow[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const sel = { code: new Set(cCode), name: new Set(cName), group: new Set(cGroup), type: new Set(cType) };
    const byGroup = new Map<string, Set<string>>();
    customers.forEach((c) => {
      if (sel.code.size && !sel.code.has(c.customer_code || "")) return;
      if (sel.name.size && !sel.name.has(c.customer_name || "")) return;
      if (sel.group.size && !sel.group.has(c.customer_group || "")) return;
      if (sel.type.size && !sel.type.has(c.tier || "")) return;
      const g = c.customer_group || "(Tanpa group)";
      let set = byGroup.get(g);
      if (!set) byGroup.set(g, (set = new Set()));
      set.add(custKey(c.customer_group, c.customer_name));
    });
    // Pisahkan unit & transaksi per group SEKALI.
    const groupOfKey = new Map<string, string>();
    byGroup.forEach((keys, g) => keys.forEach((k) => groupOfKey.set(k, g)));
    const unitsBy = new Map<string, typeof data.uioUnits>();
    data.uioUnits.forEach((u) => {
      const g = groupOfKey.get(custKey(u.customer_group, u.customer_name));
      if (g === undefined) return;
      const a = unitsBy.get(g);
      if (a) a.push(u);
      else unitsBy.set(g, [u]);
    });
    const txBy = new Map<string, typeof data.actualSalesTx>();
    data.actualSalesTx.forEach((r) => {
      const g = groupOfKey.get(custKey(r.customer_group, r.customer_name));
      if (g === undefined) return;
      const a = txBy.get(g);
      if (a) a.push(r);
      else txBy.set(g, [r]);
    });

    const out: GroupRow[] = [];
    const entries = Array.from(byGroup.entries());
    let cancelled = false;
    let i = 0;
    setBusy(true);
    const step = () => {
      if (cancelled) return;
      const end = Math.min(i + 6, entries.length);
      for (; i < end; i++) {
        const [g, keys] = entries[i];
        const gu = unitsBy.get(g) || [];
        const gt = txBy.get(g) || [];
        if (gu.length === 0 && gt.length === 0) continue;
        const list = buildDetailRows(
          data.parts,
          data.assumptions,
          data.uioUnits,
          data.priceList,
          data.customers,
          data.actualSalesTx,
          // Harga kontrak (SCPL) berlaku per Customer Group: pakai harga group ini kalau ada.
          g === "(Tanpa group)" ? calcFilters : { ...calcFilters, customerGroup: [g] },
          keys,
          { units: gu, tx: gt, priceGroup: g === "(Tanpa group)" ? "" : g }
        );
        const agg = aggregateGroup(g, keys.size, list);
        if (agg.uio > 0 || agg.actual_sales > 0 || agg.amount_market_size > 0) out.push(agg);
      }
      if (i < entries.length) setTimeout(step, 0);
      else {
        setGroupRows(out);
        setBusy(false);
      }
    };
    setTimeout(step, 0);
    return () => {
      cancelled = true;
    };
  }, [customers, cCode, cName, cGroup, cType, data, calcFilters]);

  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? groupRows.filter((g) => g.group.toLowerCase().includes(q)) : groupRows.slice();
    list.sort((a, b) => {
      const av = a[sortCol] ?? 0;
      const bv = b[sortCol] ?? 0;
      if (typeof av === "string" && typeof bv === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return list;
  }, [groupRows, search, sortCol, sortDir]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const pageRows = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const total = useMemo(() => {
    const sum = (f: (g: GroupRow) => number) => sorted.reduce((t, g) => t + f(g), 0);
    const pm = sum((g) => g.period_market);
    return {
      customers: sum((g) => g.customers),
      uio: sum((g) => g.uio),
      qty: sum((g) => g.qty_market_size),
      amount: sum((g) => g.amount_market_size),
      perMonth: sum((g) => g.amount_per_month),
      period: sum((g) => g.amount_period),
      actualQty: sum((g) => g.actual_qty),
      actual: sum((g) => g.actual_sales),
      share: pm > 0 ? sum((g) => g.actual_sales) / pm : null
    };
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
    if (search.trim()) parts.push(`Pencarian: ${search.trim()}`);
    return parts.join(" | ");
  }

  async function onExport() {
    if (exporting || sorted.length === 0) return;
    setExporting(true);
    try {
      await exportGroupToExcel(sorted, filterNote());
    } finally {
      setExporting(false);
    }
  }

  const COLS: [SortKey, string, boolean][] = [
    ["group", "Customer Group", false],
    ["customers", "Jumlah customer", false],
    ["uio", "UIO (unit)", false],
    ["qty_market_size", "Qty market size", true],
    ["amount_market_size", "Market size (Rp)", true],
    ["amount_per_month", "Market size / bulan (Rp)", true],
    ["amount_period", `Market size periode terpilih (${monthsSelected} bln) (Rp)`, true],
    ["actual_qty", "Actual qty", false],
    ["actual_sales", "Actual sales (Rp)", false],
    ["market_share", "Market share", true]
  ];

  return (
    <>
      {/* BOX 1 — Filter */}
      <div className="panel">
        <div className="panel-head">
          <h2>Filter summary</h2>
          <div className="panel-tools">
            <span className="detail-filters-info">{busy ? "Menghitung…" : `${sorted.length.toLocaleString("id-ID")} customer group`}</span>
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
            info="Kosong = 12 bulan. Market size periode terpilih = Market size / bulan × jumlah bulan yang dipilih."
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
            info="Klasifikasi key account customer (KA Nasional, KA Branch, NKA, Dealer, SHN, dst)."
          />
        </div>
      </div>

      {/* BOX 2 — Tabel summary per Customer Group */}
      <div className="panel">
        <div className="panel-head">
          <h2>Summary per Customer Group</h2>
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
              placeholder="Cari customer group…"
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
                {COLS.map(([k, label, computed]) => (
                  <th key={k} onClick={() => onSort(k)} style={{ cursor: "pointer" }} className={computed ? "computed" : undefined}>
                    {label}
                    {sortCol === k && <span className="arrow">{sortDir === "asc" ? "▲" : "▼"}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((g) => (
                <tr key={g.group}>
                  <td>{g.group}</td>
                  <td>{fmtInt(g.customers)}</td>
                  <td>{fmtInt(g.uio)}</td>
                  <td className="computed">{fmtInt(g.qty_market_size)}</td>
                  <td className="computed">{fmtIDRFull(g.amount_market_size)}</td>
                  <td className="computed">{fmtIDRFull(g.amount_per_month)}</td>
                  <td className="computed">{fmtIDRFull(g.amount_period)}</td>
                  <td>{fmtInt(g.actual_qty)}</td>
                  <td>{fmtIDRFull(g.actual_sales)}</td>
                  <td className="computed">{fmtPct(g.market_share)}</td>
                </tr>
              ))}
              {sorted.length > 0 && (
                <tr style={{ fontWeight: 600 }}>
                  <td>TOTAL</td>
                  <td>{fmtInt(total.customers)}</td>
                  <td>{fmtInt(total.uio)}</td>
                  <td className="computed">{fmtInt(total.qty)}</td>
                  <td className="computed">{fmtIDRFull(total.amount)}</td>
                  <td className="computed">{fmtIDRFull(total.perMonth)}</td>
                  <td className="computed">{fmtIDRFull(total.period)}</td>
                  <td>{fmtInt(total.actualQty)}</td>
                  <td>{fmtIDRFull(total.actual)}</td>
                  <td className="computed">{fmtPct(total.share)}</td>
                </tr>
              )}
              {sorted.length === 0 && !busy && (
                <tr>
                  <td colSpan={COLS.length} style={{ textAlign: "center", color: "var(--ink-mute)" }}>
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
            Halaman {currentPage} / {pages} · {sorted.length} group
          </span>
          <button disabled={currentPage >= pages} onClick={() => setPage((p) => p + 1)}>
            Berikutnya ›
          </button>
        </div>
      </div>
    </>
  );
}
