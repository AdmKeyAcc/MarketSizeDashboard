"use client";

import { useEffect, useMemo, useState } from "react";
import "./hierarchy.css";
import type { UseDashboardState } from "@/hooks/useDashboardState";
import { fmtIDRFull, fmtInt, resolveUioYears } from "@/lib/calculations";
import {
  HIER_DIMS,
  HIER_LABELS,
  buildCustomerIndex,
  buildTree,
  computeCustomerFacts,
  isCustomerDim,
  makeFactDeps,
  sortTree,
  type Fact,
  type HierDim,
  type SortKey,
  type TreeNode
} from "@/lib/hierarchy";
import { MONTH_ORDER } from "@/lib/types";
import { monthsShare } from "@/lib/workdays";

const MAX_LEVELS = 6;
const CHILD_CAP = 200;
const NONE = "";
const DEFAULT_LEVELS: (HierDim | "")[] = ["kaType", "group", "customer", "", "", ""];

type FlatRow = { node: TreeNode; hasKids: boolean } | { more: number; parent: string; depth: number };

const pct = (v: number | null) => (v === null || !Number.isFinite(v) ? "–" : `${(v * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`);
const rp = (v: number | null) => (v === null ? "–" : fmtIDRFull(v));

/** Dashboard: perbandingan Market Size vs Actual Sales dalam bentuk pohon (mirip Plan vs Actual di dashboard sales).
 * Market Size menggantikan Plan; Market Share = Actual ÷ Market Size periode yang sama. */
export default function HierarchyTable({ state }: { state: UseDashboardState }) {
  const { data, filters } = state;

  const [levels, setLevels] = useState<(HierDim | "")[]>(DEFAULT_LEVELS);
  const [sortKey, setSortKey] = useState<SortKey>("ms");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [zoom, setZoom] = useState(100);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState<Set<string>>(new Set());

  const activeLevels = useMemo(() => {
    const out: HierDim[] = [];
    for (const l of levels) {
      if (!l) break;
      out.push(l);
    }
    return out;
  }, [levels]);

  // ---- tahun acuan & periode ----
  const refYear = useMemo(() => {
    const ys = resolveUioYears(filters, data.uioUnits);
    if (ys.length > 0) return Math.max(...ys);
    const ay = data.actualSalesYear.map((r) => r.year);
    return ay.length > 0 ? Math.max(...ay) : null;
  }, [filters, data.uioUnits, data.actualSalesYear]);

  const ytdYear = data.meta.actual_year_ytd_year ?? null;
  const ytdMonth = data.meta.actual_year_ytd_month ?? null;
  const ytdIdx = ytdMonth ? (MONTH_ORDER as readonly string[]).indexOf(ytdMonth) : -1;
  const isYtd = refYear !== null && refYear === ytdYear && ytdIdx >= 0 && ytdIdx < 11;
  const yearHasActual = refYear !== null && data.actualSalesYear.some((r) => r.year === refYear);
  const comparable = filters.bulan.length === 0 && filters.product.length === 0 && filters.modelUnit.length === 0 && filters.partNumber.length === 0 && filters.partName.length === 0;
  const actualOk = yearHasActual && comparable;
  const factor = filters.bulan.length > 0 ? monthsShare(filters.bulan) : isYtd && yearHasActual ? monthsShare(MONTH_ORDER.slice(0, ytdIdx + 1)) : 1;
  const periodLabel =
    filters.bulan.length > 0
      ? filters.bulan.join(", ")
      : isYtd && yearHasActual
      ? `Januari–${ytdMonth}`
      : "setahun penuh";

  // ---- customer & fakta Market Size (dihitung bertahap supaya halaman tetap responsif) ----
  const custs = useMemo(
    () => buildCustomerIndex(state.realCustomers, data.uioUnits, data.actualSalesYear, data.priceList),
    [state.realCustomers, data.uioUnits, data.actualSalesYear, data.priceList]
  );
  const [facts, setFacts] = useState<Map<string, Fact[]>>(new Map());
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    if (refYear === null || data.parts.length === 0) {
      setFacts(new Map());
      setProgress(null);
      return;
    }
    const deps = makeFactDeps(data.parts, data.assumptions, data.priceList, refYear, filters);
    const withUnits = custs.filter((c) => c.units.length > 0);
    const out = new Map<string, Fact[]>();
    let i = 0;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    setProgress(0);
    const step = () => {
      if (cancelled) return;
      const t0 = performance.now();
      while (i < withUnits.length && performance.now() - t0 < 12) {
        const c = withUnits[i++];
        out.set(c.key, computeCustomerFacts(c, deps));
      }
      if (i < withUnits.length) {
        setProgress(i / withUnits.length);
        timer = setTimeout(step, 0);
      } else {
        setFacts(out);
        setProgress(null);
      }
    };
    timer = setTimeout(step, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Hanya filter produk yang memengaruhi fakta; filter customer diterapkan saat membangun pohon.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [custs, data.parts, data.assumptions, data.priceList, refYear, filters.product, filters.modelUnit, filters.partNumber, filters.partName]);

  const tree = useMemo(
    () =>
      refYear === null || activeLevels.length === 0
        ? null
        : buildTree(custs, (k) => facts.get(k), activeLevels, filters, refYear, factor, actualOk),
    [custs, facts, activeLevels, filters, refYear, factor, actualOk]
  );

  // ---- baris yang tampil ----
  const rows = useMemo<FlatRow[]>(() => {
    if (!tree) return [];
    const out: FlatRow[] = [];
    const walk = (nodes: TreeNode[]) => {
      const sorted = sortTree(nodes, sortKey, sortDir);
      const cap = sorted.length > CHILD_CAP && !showAll.has(sorted[0].id.replace(/[^¦]*$/, "")) ? CHILD_CAP : sorted.length;
      sorted.slice(0, cap).forEach((n) => {
        out.push({ node: n, hasKids: n.children.length > 0 });
        if (expanded.has(n.id) && n.children.length > 0) walk(n.children);
      });
      if (cap < sorted.length) out.push({ more: sorted.length - cap, parent: sorted[0].id.replace(/[^¦]*$/, ""), depth: sorted[0].depth });
    };
    walk(tree.roots);
    return out;
  }, [tree, sortKey, sortDir, expanded, showAll]);

  function setLevel(i: number, v: HierDim | "") {
    setLevels((prev) => {
      const next = prev.slice();
      next[i] = v;
      if (!v) for (let j = i + 1; j < next.length; j++) next[j] = NONE;
      return next;
    });
    setExpanded(new Set());
    setShowAll(new Set());
  }
  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function expandAll() {
    if (!tree) return;
    const ids = new Set<string>();
    const walk = (ns: TreeNode[]) => ns.forEach((n) => {
      if (n.children.length > 0) {
        ids.add(n.id);
        walk(n.children);
      }
    });
    walk(tree.roots);
    setExpanded(ids);
  }

  async function download() {
    if (!tree) return;
    const XLSX = await import("@e965/xlsx");
    const aoa: (string | number | null)[][] = [
      [`HIERARKI (${activeLevels.map((l) => HIER_LABELS[l]).join(" > ")}) — tahun ${refYear}, periode ${periodLabel}`, "UIO (unit)", "Market Size (Rp)", "Actual (Rp)", "Variance (Rp)", "Market Share"]
    ];
    const push = (n: TreeNode) => {
      const a = n.actual;
      aoa.push([
        "    ".repeat(n.depth) + n.label,
        Math.round(n.uio),
        Math.round(n.ms),
        a === null ? null : Math.round(a),
        a === null ? null : Math.round(a - n.ms),
        a === null || n.ms <= 0 ? null : a / n.ms
      ]);
      sortTree(n.children, sortKey, sortDir).forEach(push);
    };
    aoa.push([
      "TOTAL",
      Math.round(tree.totalUio),
      Math.round(tree.totalMs),
      tree.totalActual === null ? null : Math.round(tree.totalActual),
      tree.totalActual === null ? null : Math.round(tree.totalActual - tree.totalMs),
      tree.totalActual === null || tree.totalMs <= 0 ? null : tree.totalActual / tree.totalMs
    ]);
    sortTree(tree.roots, sortKey, sortDir).forEach(push);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 56 }, { wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Market Size vs Actual");
    XLSX.writeFile(wb, `Market_Size_vs_Actual_${refYear}.xlsx`);
  }

  const noPath = !activeLevels.every(isCustomerDim);
  const totalVar = tree && tree.totalActual !== null ? tree.totalActual - tree.totalMs : null;
  const totalShare = tree && tree.totalActual !== null && tree.totalMs > 0 ? tree.totalActual / tree.totalMs : null;

  return (
    <>
      <div className="panel hier-controls">
        <div className="panel-head">
          <h2>Hierarchy Controls</h2>
          <div className="hier-actions">
            <button className="btn btn-ghost" onClick={expandAll}>Expand semua</button>
            <button className="btn btn-ghost" onClick={() => setExpanded(new Set())}>Collapse semua</button>
            <button className="btn btn-primary" onClick={download} disabled={!tree}>⭳ Download Excel</button>
          </div>
        </div>
        <div className="hier-levels">
          {levels.slice(0, MAX_LEVELS).map((l, i) => {
            const prevEmpty = i > 0 && !levels[i - 1];
            return (
              <label className="hier-level" key={i}>
                <span>Level {i + 1}</span>
                <select value={l} disabled={prevEmpty} onChange={(e) => setLevel(i, e.target.value as HierDim | "")}>
                  <option value={NONE}>{i === 0 ? "— pilih —" : "(tidak ada)"}</option>
                  {HIER_DIMS.map((d) => (
                    <option key={d} value={d} disabled={levels.some((x, j) => j !== i && x === d)}>
                      {HIER_LABELS[d]}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
          <label className="hier-level">
            <span>Urutkan</span>
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
              <option value="name">Nama</option>
              <option value="ms">Market Size</option>
              <option value="actual">Actual</option>
            </select>
          </label>
          <div className="hier-level">
            <span>Arah</span>
            <div className="seg">
              <button className={`seg-btn${sortDir === "desc" ? " active" : ""}`} onClick={() => setSortDir("desc")}>↓ Besar</button>
              <button className={`seg-btn${sortDir === "asc" ? " active" : ""}`} onClick={() => setSortDir("asc")}>↑ Kecil</button>
            </div>
          </div>
          <div className="hier-level">
            <span>Zoom</span>
            <div className="seg">
              <button className="seg-btn" onClick={() => setZoom((z) => Math.max(70, z - 10))}>−</button>
              <button className="seg-btn" onClick={() => setZoom(100)}>{zoom}%</button>
              <button className="seg-btn" onClick={() => setZoom((z) => Math.min(150, z + 10))}>+</button>
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>
            Market Size vs Actual Sales{refYear !== null ? ` — ${refYear}` : ""}
            <span
              className="info-dot"
              title={`Market Size menggantikan Plan. Market Size ${refYear ?? ""} = populasi UIO (unit sampai tahun ${refYear ?? ""}) × kebutuhan part per tahun × harga. Actual = laporan penjualan tahun ${refYear ?? ""}. Variance = Actual − Market Size. Market Share = Actual ÷ Market Size periode yang sama.`}
            >
              i
            </span>
          </h2>
          <span className="hier-sub">
            Periode {periodLabel}
            {tree ? ` · ${tree.customers.toLocaleString("id-ID")} customer` : ""}
          </span>
        </div>

        {progress !== null && (
          <div className="hier-progress">
            <div style={{ width: `${Math.round(progress * 100)}%` }} />
            <span>Menghitung Market Size per customer… {Math.round(progress * 100)}%</span>
          </div>
        )}

        {data.parts.length === 0 || refYear === null ? (
          <div className="empty-hint" style={{ margin: 0 }}>Belum ada Data UIO / Actual Sales, jadi perbandingan belum bisa dihitung.</div>
        ) : activeLevels.length === 0 ? (
          <div className="empty-hint" style={{ margin: 0 }}>Pilih minimal Level 1 di Hierarchy Controls.</div>
        ) : (
          <>
            {!actualOk && (
              <div className="hier-note">
                {data.actualSalesYear.length === 0
                  ? "Laporan Actual Sales tahunan belum diupload (menu ⭱ Upload → slot 1), jadi kolom Actual tidak diisi."
                  : !yearHasActual
                  ? `Laporan Actual Sales belum punya data tahun ${refYear}, jadi kolom Actual tidak diisi.`
                  : "Laporan Actual Sales berupa total setahun per customer, jadi tidak bisa dibandingkan saat filter Bulan / Product / Model / Part dipakai — kolom Actual tidak diisi."}
              </div>
            )}
            {actualOk && noPath && (
              <div className="hier-note">
                Actual Sales hanya tersedia sampai level customer (Area, PSS, KA Type, Group, Customer). Level Product / Model hanya menampilkan Market Size.
              </div>
            )}
            <div className="hier-scroll" style={{ fontSize: `${(13 * zoom) / 100}px` }}>
              <table className="hier-table">
                <thead>
                  <tr>
                    <th>HIERARKI</th>
                    <th className="num">UIO</th>
                    <th className="num">MARKET SIZE</th>
                    <th className="num">ACTUAL</th>
                    <th className="num">VARIANCE</th>
                    <th className="hier-sharecol">MARKET SHARE %</th>
                  </tr>
                </thead>
                <tbody>
                  {tree && (
                    <tr className="hier-total">
                      <td>TOTAL</td>
                      <td className="num mono">{fmtInt(tree.totalUio)}</td>
                      <td className="num mono">{rp(tree.totalMs)}</td>
                      <td className="num mono">{rp(tree.totalActual)}</td>
                      <td className={`num mono${totalVar !== null && totalVar < 0 ? " neg" : ""}`}>{rp(totalVar)}</td>
                      <td><ShareBar v={totalShare} /></td>
                    </tr>
                  )}
                  {rows.map((r, i) => {
                    if ("more" in r) {
                      return (
                        <tr key={`more-${r.parent}-${i}`} className="hier-more">
                          <td colSpan={6} style={{ paddingLeft: 12 + r.depth * 20 }}>
                            <button className="link-btn" onClick={() => setShowAll((p) => new Set(p).add(r.parent))}>
                              + {r.more.toLocaleString("id-ID")} baris lainnya — tampilkan semua
                            </button>
                          </td>
                        </tr>
                      );
                    }
                    const n = r.node;
                    const a = n.actual;
                    const v = a === null ? null : a - n.ms;
                    const share = a !== null && n.ms > 0 ? a / n.ms : null;
                    const open = expanded.has(n.id);
                    return (
                      <tr key={n.id} className={`hier-row depth-${Math.min(n.depth, 5)}`}>
                        <td style={{ paddingLeft: 10 + n.depth * 20 }}>
                          {r.hasKids ? (
                            <button className="hier-toggle" onClick={() => toggle(n.id)} aria-label={open ? "Tutup" : "Buka"}>
                              {open ? "▾" : "▸"}
                            </button>
                          ) : (
                            <span className="hier-toggle-gap" />
                          )}
                          <span className="hier-label" title={`${HIER_LABELS[n.dim]}: ${n.label}`}>{n.label}</span>
                        </td>
                        <td className="num mono">{fmtInt(n.uio)}</td>
                        <td className="num mono">{rp(n.ms)}</td>
                        <td className="num mono">{rp(a)}</td>
                        <td className={`num mono${v !== null && v < 0 ? " neg" : ""}`}>{rp(v)}</td>
                        <td><ShareBar v={share} /></td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && progress === null && (
                    <tr>
                      <td colSpan={6} className="hier-empty">Tidak ada data untuk kombinasi filter ini.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function ShareBar({ v }: { v: number | null }) {
  if (v === null || !Number.isFinite(v)) return <span className="hier-share-na">–</span>;
  const w = Math.max(0, Math.min(1, v)) * 100;
  return (
    <div className="hier-share">
      <div className="hier-share-bar"><div style={{ width: `${w}%` }} /></div>
      <span className="mono">{pct(v)}</span>
    </div>
  );
}
