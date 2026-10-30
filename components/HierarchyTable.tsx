"use client";

import { useMemo, useState } from "react";
import "./hierarchy.css";
import type { UseDashboardState } from "@/hooks/useDashboardState";
import { resolveUioYears } from "@/lib/calculations";
import {
  HIER_DIMS,
  HIER_LABELS,
  buildTree,
  mergeYearTrees,
  sortTree,
  type HierDim,
  type SortKey,
  type TreeNodeM,
  type YearVals
} from "@/lib/hierarchy";

const MAX_LEVELS = 6;
/** Jumlah tahun yang ditampilkan berdampingan (tahun acuan + tahun-tahun sebelumnya). */
const WINDOW = 3;
const CHILD_CAP = 200;
const NONE = "";
const DEFAULT_LEVELS: (HierDim | "")[] = ["kaType", "group", "customer", "", "", ""];

type FlatRow = { node: TreeNodeM; hasKids: boolean } | { more: number; parent: string; depth: number };

const pct = (v: number | null) => (v === null || !Number.isFinite(v) ? "–" : `${(v * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`);
const num = (v: number | null) => (v === null || !Number.isFinite(v) ? "–" : Math.round(v).toLocaleString("id-ID"));
const signed = (v: number | null) => (v === null || !Number.isFinite(v) ? "–" : `${v > 0 ? "+" : ""}${Math.round(v).toLocaleString("id-ID")}`);

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

  // ---- tahun acuan & jendela 3 tahun (tahun acuan + 2 tahun sebelumnya) ----
  const refYear = useMemo(() => {
    const ys = resolveUioYears(filters, data.uioUnits);
    if (ys.length > 0) return Math.max(...ys);
    const ay = data.actualSalesYear.map((r) => r.year);
    return ay.length > 0 ? Math.max(...ay) : null;
  }, [filters, data.uioUnits, data.actualSalesYear]);
  const years = useMemo(
    () => (refYear === null ? [] : state.factYears.filter((y) => y <= refYear && y >= refYear - (WINDOW - 1))),
    [refYear, state.factYears]
  );

  // Periode & keterbandingan Actual: aturan yang sama dengan KPI dan chart (lib/period.ts → comparePlan).
  const plan = state.plan;
  const ytdMonth = data.meta.actual_year_ytd_month ?? null;
  const actualOkOf = (y: number) => plan.actualOkOf(y);
  const yearLabel = (y: number) => plan.labelOf(y);
  const actualOk = refYear !== null && actualOkOf(refYear);
  const refMonths = refYear !== null ? plan.monthsOf(refYear) : null;
  const periodLabel =
    filters.bulan.length > 0 ? filters.bulan.join(", ") : refMonths ? `Januari–${ytdMonth}` : "/year";

  // ---- Market Size per customer & tahun datang dari mesin hitung bersama (juga dipakai chart & KPI) ----
  const custs = state.custIndex;
  const facts = state.yearFacts;
  const progress = state.factsProgress;

  const tree = useMemo(() => {
    if (refYear === null || activeLevels.length === 0 || years.length === 0) return null;
    const items = years.map((y) => ({
      year: y,
      actualOk: actualOkOf(y),
      tree: buildTree(custs, (k) => facts.get(y)?.get(k), activeLevels, filters, y, plan.monthsOf(y), plan.actualMonthsOf(y), actualOkOf(y))
    }));
    return mergeYearTrees(items, refYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [custs, facts, activeLevels, filters, refYear, years, plan]);

  // ---- baris yang tampil ----
  const rows = useMemo<FlatRow[]>(() => {
    if (!tree) return [];
    const out: FlatRow[] = [];
    const walk = (nodes: TreeNodeM[]) => {
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
    const walk = (ns: TreeNodeM[]) => ns.forEach((n) => {
      if (n.children.length > 0) {
        ids.add(n.id);
        walk(n.children);
      }
    });
    walk(tree.roots);
    setExpanded(ids);
  }

  async function download() {
    if (!tree || refYear === null) return;
    const { downloadHierarchyXlsx } = await import("@/lib/downloadHierarchy");
    await downloadHierarchyXlsx({ tree, years, refYear, yearLabel, levels: activeLevels, sortKey, sortDir, expanded, filters, periodLabel });
  }

  const COLS = 3 + years.length * 3;
  const yvCells = (yr: Record<number, YearVals> | undefined, uio: number) => {
    const m = refYear !== null ? yr?.[refYear] : undefined;
    const v = m && m.actual !== null ? m.actual - m.ms : null;
    return (
      <>
        <td className="c-uio">{num(uio)}</td>
        {years.map((y, k) => {
          const q = yr?.[y];
          const a = q ? q.actual : null;
          const share = a !== null && q && q.ms > 0 ? a / q.ms : null;
          return [
            <td key={`m${y}`} className={`c-ms${k === 0 ? " yg" : " yg"}`}>{num(q ? q.ms : 0)}</td>,
            <td key={`a${y}`} className="c-act">{num(a)}</td>,
            <td key={`s${y}`} className="c-share"><ShareBar v={share} /></td>
          ];
        })}
        <td className={`c-var yg${varCls(v)}`}>{signed(v)}</td>
      </>
    );
  };

  const SORTS: { key: SortKey; label: string }[] = [
    { key: "name", label: "Name" },
    { key: "ms", label: "Market Size" },
    { key: "actual", label: "Actual" }
  ];
  const varCls = (v: number | null) => (v === null ? "" : v < 0 ? " neg" : v > 0 ? " pos" : "");

  return (
    <>
      <div className="hc-card">
        <div className="hc-head">
          <div className="hc-title">
            <IconList />
            <span>Hierarchy Controls</span>
          </div>
          <div className="hc-tools">
            <button className="hc-btn" onClick={expandAll} title="Buka semua baris"><IconPlusBox />Expand</button>
            <button className="hc-btn" onClick={() => setExpanded(new Set())} title="Tutup semua baris"><IconMinusBox />Collapse</button>
            <span className="hc-sep" />
            <span className="hc-lbl">Sort:</span>
            <div className="hc-seg">
              {SORTS.map((o) => (
                <button key={o.key} className={sortKey === o.key ? "active" : ""} onClick={() => setSortKey(o.key)}>
                  <IconSort />{o.label}
                </button>
              ))}
            </div>
            <button
              className="hc-iconbtn"
              onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
              title={sortDir === "desc" ? "Urut dari besar ke kecil" : "Urut dari kecil ke besar"}
            >
              <IconDir asc={sortDir === "asc"} />
            </button>
            <span className="hc-sep" />
            <span className="hc-lbl"><IconFrame />Zoom</span>
            <div className="hc-zoom">
              <button onClick={() => setZoom((z) => Math.max(70, z - 10))} aria-label="Perkecil"><IconZoom plus={false} /></button>
              <input type="range" min={70} max={150} step={5} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" />
              <button onClick={() => setZoom((z) => Math.min(150, z + 10))} aria-label="Perbesar"><IconZoom plus /></button>
              <span className="hc-zoomval" onClick={() => setZoom(100)} title="Reset ke 100%">{zoom}%</span>
            </div>
            <span className="hc-sep" />
            <button className="hc-iconbtn" onClick={download} disabled={!tree} title="Download Excel"><IconDownload /></button>
          </div>
        </div>
        <div className="hc-levels">
          {levels.slice(0, MAX_LEVELS).map((l, i) => {
            const prevEmpty = i > 0 && !levels[i - 1];
            return (
              <label className={`hc-level${prevEmpty ? " off" : ""}`} key={i}>
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
        </div>
      </div>

      <div className="ht-card">
        <div className="ht-sub">
          <span>
            Market Size vs Actual Sales{years.length > 1 ? ` — ${years[0]}–${refYear}` : refYear !== null ? ` — ${refYear}` : ""}
            <span
              className="info-dot"
              title={`Market Size per tahun ditampilkan berdampingan untuk ${WINDOW} tahun terakhir sampai tahun acuan ${refYear ?? ""}. Market Size tiap tahun = populasi UIO (unit sampai tahun itu) × kebutuhan part per tahun × harga. Actual = laporan penjualan tahun yang sama. Market Share = Actual ÷ Market Size. Variance = Actual − Market Size (tahun acuan). Semua filter berlaku sama untuk tabel, chart, dan KPI.`}
            >
              i
            </span>
          </span>
          <span>
            Periode {periodLabel} (tahun acuan {refYear})
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
          <div className="ht-empty">Belum ada Data UIO / Actual Sales, jadi perbandingan belum bisa dihitung.</div>
        ) : activeLevels.length === 0 ? (
          <div className="ht-empty">Pilih minimal Level 1 di Hierarchy Controls.</div>
        ) : (
          <>
            {!actualOk && (
              <div className="hier-note">
                {data.actualSalesYear.length === 0
                  ? "Data Actual Sales belum ada (sinkron dari web Sales di menu ⭱ Upload), jadi kolom Actual tidak diisi."
                  : `${refYear !== null ? plan.whyNot(refYear) : ""} Kolom Actual tidak diisi.`}
              </div>
            )}
            <div className="ht-scroll">
              <table className="ht-table" style={{ zoom: zoom / 100 }}>
                <thead>
                  <tr className="th-top">
                    <th className="c-name" rowSpan={2}>Hierarchy</th>
                    <th className="c-uio" rowSpan={2}>UIO {refYear}</th>
                    {years.map((y) => (
                      <th key={y} className={`c-yr yg${y === refYear ? " cur" : ""}`} colSpan={3}>{yearLabel(y)}</th>
                    ))}
                    <th className="c-var yg" rowSpan={2}>Variance {refYear}</th>
                  </tr>
                  <tr className="th-sub">
                    {years.map((y) => [
                      <th key={`m${y}`} className="c-ms yg">Market Size</th>,
                      <th key={`a${y}`} className="c-act">Actual</th>,
                      <th key={`s${y}`} className="c-share">Share %</th>
                    ])}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    if ("more" in r) {
                      return (
                        <tr key={`more-${r.parent}-${i}`} className="ht-more">
                          <td colSpan={COLS} style={{ paddingLeft: 16 + r.depth * 24 }}>
                            <button className="link-btn" onClick={() => setShowAll((p) => new Set(p).add(r.parent))}>
                              + {r.more.toLocaleString("id-ID")} baris lainnya — tampilkan semua
                            </button>
                          </td>
                        </tr>
                      );
                    }
                    const n = r.node;
                    const open = expanded.has(n.id);
                    return (
                      <tr key={n.id} className={`ht-row d${Math.min(n.depth, 3)}`}>
                        <td className="c-name" style={{ paddingLeft: 14 + n.depth * 24 }}>
                          {r.hasKids ? (
                            <button className="ht-toggle" onClick={() => toggle(n.id)} aria-label={open ? "Tutup" : "Buka"}>
                              {open ? <IconMinusBox /> : <IconPlusBox />}
                            </button>
                          ) : (
                            <span className="ht-toggle-gap" />
                          )}
                          <span className="ht-label" title={`${HIER_LABELS[n.dim]}: ${n.label}`}>{n.label}</span>
                        </td>
                        {yvCells(n.yr, n.uio)}
                      </tr>
                    );
                  })}
                  {rows.length === 0 && progress === null && (
                    <tr>
                      <td colSpan={COLS} className="ht-empty">Tidak ada data untuk kombinasi filter ini.</td>
                    </tr>
                  )}
                </tbody>
                {tree && (
                  <tfoot>
                    <tr>
                      <td className="c-name">Grand Total</td>
                      {yvCells(tree.totals, (tree.totals[tree.mainYear]?.uio ?? 0))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function ShareBar({ v }: { v: number | null }) {
  if (v === null || !Number.isFinite(v)) return <span className="ht-na">–</span>;
  const w = Math.max(0, Math.min(1, v)) * 100;
  return (
    <div className="ht-share">
      <span>{pct(v)}</span>
      <div className="ht-bar"><div style={{ width: `${w}%` }} /></div>
    </div>
  );
}

/* ---- ikon ---- */
const svgp = { width: 16, height: 16, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
const IconList = () => (<svg {...svgp} width={20} height={20}><rect x="2.5" y="3" width="4" height="4" rx="1" /><rect x="2.5" y="12" width="4" height="4" rx="1" /><path d="M10 5h7M10 14h7M10 8.5h4M10 17.5h4" /></svg>);
const IconSort = () => (<svg {...svgp} width={13} height={13}><path d="M6 3v13M3 13l3 3 3-3M14 17V4M11 7l3-3 3 3" /></svg>);
const IconDir = ({ asc }: { asc: boolean }) => (<svg {...svgp} width={18} height={18} style={{ transform: asc ? "scaleY(-1)" : undefined }}><path d="M3 5h14M3 10h9M3 15h4M15 10v7M12.5 14.5L15 17l2.5-2.5" /></svg>);
const IconFrame = () => (<svg {...svgp} width={14} height={14}><path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" /></svg>);
const IconZoom = ({ plus }: { plus: boolean }) => (<svg {...svgp} width={17} height={17}><circle cx="9" cy="9" r="6" /><path d="M14 14l3.5 3.5M6.5 9h5" />{plus && <path d="M9 6.5v5" />}</svg>);
const IconDownload = () => (<svg {...svgp} width={20} height={20}><path d="M10 3v10M6 9.5l4 4 4-4M3.5 16.5h13" /></svg>);
const IconPlusBox = () => (<svg {...svgp} width={18} height={18}><rect x="3" y="3" width="14" height="14" rx="3" /><path d="M10 6.8v6.4M6.8 10h6.4" /></svg>);
const IconMinusBox = () => (<svg {...svgp} width={18} height={18}><rect x="3" y="3" width="14" height="14" rx="3" /><path d="M6.8 10h6.4" /></svg>);
