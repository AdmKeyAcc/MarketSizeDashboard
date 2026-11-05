"use client";

import { Fragment, useMemo, useState } from "react";
import type { UseDashboardState } from "@/hooks/useDashboardState";
import { canonicalProduct, fmtInt } from "@/lib/calculations";
import type { UioUnit } from "@/lib/types";
import LevelPicker, { activeLevels } from "@/components/LevelPicker";

const UIO_DIMS = ["branch", "pss", "custType", "group", "customer", "priceType", "product", "model", "year"] as const;
type UioDim = (typeof UIO_DIMS)[number];
const UIO_LABELS: Record<UioDim, string> = {
  branch: "Branch", pss: "PSS", custType: "Customer Type", group: "Customer Group", customer: "Customer Name",
  priceType: "Price Type", product: "Product", model: "Model", year: "Year BAST"
};
const blank = (v: string | number | null | undefined, none: string) => (v === null || v === undefined || String(v).trim() === "" ? none : String(v).trim());
const dimOf = (d: UioDim, u: UioUnit): string => {
  switch (d) {
    case "branch": return blank(u.branch?.toUpperCase(), "(Tanpa Branch)");
    case "pss": return blank(u.pss_name?.toUpperCase(), "(Tanpa PSS)");
    case "custType": return blank(u.customer_type?.toUpperCase(), "(Tanpa Customer Type)");
    case "group": return blank(u.customer_group?.toUpperCase(), "(Tanpa Group)");
    case "customer": return blank(u.customer_name?.toUpperCase(), "(Tanpa Nama)");
    case "priceType": return blank(u.price_type, "(Tanpa Price Type)");
    case "product": return blank(u.product ? canonicalProduct(u.product) : null, "(Tanpa Product)");
    case "model": return blank(u.model?.toUpperCase(), "(Tanpa Model)");
    case "year": return blank(u.year, "(Tanpa Year BAST)");
  }
};
type UNode = { id: string; dim: UioDim; label: string; depth: number; units: UioUnit[]; children: UNode[] };
function buildUioTree(units: UioUnit[], levels: UioDim[], depth = 0, parent = ""): UNode[] {
  if (depth >= levels.length) return [];
  const d = levels[depth];
  const m = new Map<string, UioUnit[]>();
  units.forEach((u) => {
    const k = dimOf(d, u);
    const arr = m.get(k);
    if (arr) arr.push(u);
    else m.set(k, [u]);
  });
  const nodes = Array.from(m.entries()).map(([label, us]) => {
    const id = `${parent}¦${label}`;
    return { id, dim: d, label, depth, units: us, children: buildUioTree(us, levels, depth + 1, id) };
  });
  nodes.sort((a, b) => (d === "year" ? a.label.localeCompare(b.label) : b.units.length - a.units.length || a.label.localeCompare(b.label)));
  return nodes;
}
const UNIT_CAP = 50;
/** Baris Level 1 yang ditampilkan dulu (sisanya lewat tombol), supaya halaman tetap ringan. */
const TOP_CAP = 100;
/** Baris anak per baris induk yang ditampilkan dulu. */
const KID_CAP = 50;

type Col = { key: string; label: string; num?: boolean; get: (u: UioUnit) => string | number | null };

// Urutan kolom = urutan kolom di template upload Data UIO.
const COLS: Col[] = [
  { key: "branch", label: "Branch", get: (u) => u.branch },
  { key: "pss_name", label: "Pss Name", get: (u) => u.pss_name ?? null },
  { key: "customer_code", label: "Cust. Code", get: (u) => u.customer_code ?? null },
  { key: "customer_name", label: "Cust. Name", get: (u) => u.customer_name },
  { key: "customer_group", label: "Cust. Group", get: (u) => u.customer_group },
  { key: "customer_type", label: "Cust. Type", get: (u) => u.customer_type ?? null },
  { key: "price_type", label: "Price Type", get: (u) => u.price_type ?? null },
  { key: "product", label: "Product", get: (u) => u.product },
  { key: "model", label: "Model", get: (u) => u.model },
  { key: "serial_number", label: "Serial Number", get: (u) => u.serial_number },
  { key: "year", label: "Year BAST", num: true, get: (u) => u.year },
  { key: "month_inv", label: "Month BAST", num: true, get: (u) => u.month_inv ?? null },
  { key: "hm_day", label: "HM/Day", num: true, get: (u) => u.hm_day ?? null },
  { key: "day_month", label: "Day/Month", num: true, get: (u) => u.day_month ?? null },
  { key: "month_year", label: "Month/Year", num: true, get: (u) => u.month_year ?? null }
];
const PAGE_SIZE = 20;

/** Detail UIO per unit di bawah chart "UIO per Product". Kolom & urutannya
 * sama dengan format upload Data UIO. Mengikuti filter di bagian atas. */
export default function UioDetailTable({ state }: { state: UseDashboardState }) {
  const rows = state.uioUnitsScoped;
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<string>("product");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [levels, setLevels] = useState<(UioDim | "")[]>(["", "", "", ""]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [unitShow, setUnitShow] = useState<Map<string, number>>(new Map());
  const [topShow, setTopShow] = useState(TOP_CAP);
  const [kidShow, setKidShow] = useState<Map<string, number>>(new Map());
  const act = useMemo(() => activeLevels(levels), [levels]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((u) => COLS.some((c) => String(c.get(u) ?? "").toLowerCase().includes(s)));
  }, [rows, search]);

  const sorted = useMemo(() => {
    const col = COLS.find((c) => c.key === sortCol) || COLS[0];
    const copy = filtered.slice();
    copy.sort((a, b) => {
      const av = col.get(a);
      const bv = col.get(b);
      let c: number;
      if (av === null && bv === null) c = 0;
      else if (av === null) c = 1;
      else if (bv === null) c = -1;
      else if (typeof av === "number" && typeof bv === "number") c = av - bv;
      else c = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? c : -c;
    });
    return copy;
  }, [filtered, sortCol, sortDir]);

  const tree = useMemo(() => (act.length > 0 ? buildUioTree(sorted, act) : []), [sorted, act]);
  const flat = useMemo(() => {
    const out: (UNode | { more: number; parent: string; depth: number })[] = [];
    const walk = (ns: UNode[]) => ns.forEach((n) => {
      out.push(n);
      if (!expanded.has(n.id)) return;
      const cap = kidShow.get(n.id) ?? KID_CAP;
      walk(n.children.slice(0, cap));
      if (n.children.length > cap) out.push({ more: n.children.length - cap, parent: n.id, depth: n.depth + 1 });
    });
    walk(tree.slice(0, topShow));
    return out;
  }, [tree, expanded, topShow, kidShow]);
  function toggle(id: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function expandAll() {
    const ids = new Set<string>();
    const walk = (ns: UNode[]) => ns.forEach((n) => {
      if (n.children.length > 0) {
        ids.add(n.id);
        walk(n.children);
      }
    });
    walk(tree);
    setExpanded(ids);
  }
  const totalUnits = sorted.length;

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const pageRows = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function onSort(key: string) {
    if (sortCol === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(key);
      setSortDir("asc");
    }
    setPage(1);
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Detail UIO</h2>
        <div className="panel-tools">
          <span className="detail-filters-info">{fmtInt(filtered.length)} unit</span>
          <input
            className="search-input"
            placeholder="Cari customer / model / serial number…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>
      <div style={{ padding: "0 16px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <b style={{ fontSize: 12.5, letterSpacing: ".06em", textTransform: "uppercase" }}>Hierarchy Controls</b>
          {act.length > 0 && (
            <>
              <button type="button" className="btn btn-ghost" onClick={expandAll}>+ Expand</button>
              <button type="button" className="btn btn-ghost" onClick={() => setExpanded(new Set())}>− Collapse</button>
            </>
          )}
        </div>
        <LevelPicker
          levels={levels}
          dims={UIO_DIMS}
          labels={UIO_LABELS}
          firstOptional
          onChange={(next) => {
            setLevels(next);
            setExpanded(new Set());
            setUnitShow(new Map());
            setTopShow(TOP_CAP);
            setKidShow(new Map());
          }}
        />
      </div>
      {rows.length === 0 ? (
        <div className="empty-hint" style={{ margin: 0 }}>
          Belum ada Data UIO untuk filter ini.
        </div>
      ) : act.length > 0 ? (
        <div className="table-scroll">
          <table className="data compact">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Hierarchy ({act.map((d) => UIO_LABELS[d]).join(" › ")})</th>
                <th style={{ textAlign: "right" }}>UIO (unit)</th>
                <th style={{ textAlign: "right" }}>% unit</th>
              </tr>
            </thead>
            <tbody>
              {flat.map((n) => {
                if ("more" in n)
                  return (
                    <tr key={`${n.parent}>more`}>
                      <td colSpan={3} style={{ paddingLeft: 12 + n.depth * 22 }}>
                        <button type="button" className="link-btn" onClick={() => setKidShow((p) => new Map(p).set(n.parent, (p.get(n.parent) ?? KID_CAP) + KID_CAP))}>
                          + {fmtInt(Math.min(KID_CAP, n.more))} baris lagi (dari {fmtInt(n.more)} sisa)
                        </button>
                      </td>
                    </tr>
                  );
                const open = expanded.has(n.id);
                const leaf = n.children.length === 0;
                const shown = unitShow.get(n.id) ?? UNIT_CAP;
                return (
                  <Fragment key={n.id}>
                    <tr style={n.depth === 0 ? { fontWeight: 600 } : undefined}>
                      <td style={{ paddingLeft: 12 + n.depth * 22 }}>
                        <button
                          type="button"
                          onClick={() => toggle(n.id)}
                          aria-label={open ? "Tutup" : "Buka"}
                          title={leaf ? (open ? "Tutup daftar unit" : "Tampilkan daftar unit") : open ? "Tutup" : "Buka"}
                          style={{ width: 20, height: 20, lineHeight: "16px", marginRight: 8, borderRadius: 4, border: "1px solid var(--line, #c9d1dc)", background: "transparent", color: "inherit", cursor: "pointer", fontWeight: 700 }}
                        >
                          {open ? "−" : "+"}
                        </button>
                        <span title={`${UIO_LABELS[n.dim]}: ${n.label}`}>{n.label}</span>
                      </td>
                      <td style={{ textAlign: "right" }} className="mono">{fmtInt(n.units.length)}</td>
                      <td style={{ textAlign: "right" }} className="mono">
                        {totalUnits > 0 ? `${((n.units.length / totalUnits) * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%` : "–"}
                      </td>
                    </tr>
                    {open && leaf && (
                      <tr>
                        <td colSpan={3} style={{ padding: "4px 8px 10px", paddingLeft: 12 + (n.depth + 1) * 22, background: "rgba(127,127,127,0.05)" }}>
                          <table className="data compact">
                            <thead>
                              <tr>
                                {COLS.map((c) => (
                                  <th key={c.key} style={{ textAlign: c.num ? "right" : "left" }}>{c.label}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {n.units.slice(0, shown).map((u, i) => (
                                <tr key={`${u.id ?? ""}|${u.serial_number ?? ""}|${i}`}>
                                  {COLS.map((c) => {
                                    const v = c.get(u);
                                    return (
                                      <td key={c.key} style={{ textAlign: c.num ? "right" : "left" }} className={c.num ? "mono" : undefined}>
                                        {v === null || v === "" ? "-" : v}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {n.units.length > shown && (
                            <button type="button" className="link-btn" onClick={() => setUnitShow((p) => new Map(p).set(n.id, shown + UNIT_CAP))}>
                              + {fmtInt(Math.min(UNIT_CAP, n.units.length - shown))} unit lagi (dari {fmtInt(n.units.length - shown)} sisa)
                            </button>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {tree.length > topShow && (
                <tr>
                  <td colSpan={3}>
                    <button type="button" className="link-btn" onClick={() => setTopShow((n) => n + TOP_CAP)}>
                      + {fmtInt(Math.min(TOP_CAP, tree.length - topShow))} baris lagi (dari {fmtInt(tree.length - topShow)} sisa)
                    </button>
                  </td>
                </tr>
              )}
              <tr style={{ fontWeight: 600 }}>
                <td>Grand Total</td>
                <td style={{ textAlign: "right" }} className="mono">{fmtInt(totalUnits)}</td>
                <td style={{ textAlign: "right" }} className="mono">{totalUnits > 0 ? "100%" : "–"}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="table-scroll">
            <table className="data compact">
              <thead>
                <tr>
                  {COLS.map((c) => (
                    <th key={c.key} onClick={() => onSort(c.key)} style={{ textAlign: c.num ? "right" : "left", cursor: "pointer" }}>
                      {c.label}
                      {sortCol === c.key && <span className="arrow">{sortDir === "asc" ? "▲" : "▼"}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((u, i) => (
                  <tr key={`${u.id ?? ""}|${u.serial_number ?? ""}|${i}`}>
                    {COLS.map((c) => {
                      const v = c.get(u);
                      return (
                        <td key={c.key} style={{ textAlign: c.num ? "right" : "left" }} className={c.num ? "mono" : undefined}>
                          {v === null || v === "" ? "-" : v}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <button disabled={currentPage <= 1} onClick={() => setPage((p) => p - 1)}>
              ‹ Sebelumnya
            </button>
            <span>
              Halaman {currentPage} / {pages} · {sorted.length.toLocaleString("id-ID")} unit
            </span>
            <button disabled={currentPage >= pages} onClick={() => setPage((p) => p + 1)}>
              Berikutnya ›
            </button>
          </div>
        </>
      )}
    </div>
  );
}
