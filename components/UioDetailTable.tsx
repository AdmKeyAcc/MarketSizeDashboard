"use client";

import { useMemo, useState } from "react";
import type { UseDashboardState } from "@/hooks/useDashboardState";
import { fmtInt, type UioDetailRow } from "@/lib/calculations";

type SortKey = "product" | "model" | "year" | "units";

const COLS: { key: SortKey; label: string; num?: boolean }[] = [
  { key: "product", label: "Product" },
  { key: "model", label: "Model" },
  { key: "year", label: "Tahun delivery", num: true },
  { key: "units", label: "Unit", num: true }
];
const PAGE_SIZE = 15;

/** Rincian angka di balik chart "UIO per Product": jumlah unit per Product,
 * Model, dan Tahun delivery (Year Inv). Mengikuti filter di bagian atas. */
export default function UioDetailTable({ state }: { state: UseDashboardState }) {
  const rows = state.uioDetail;
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<SortKey>("units");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => r.product.toLowerCase().includes(s) || r.model.toLowerCase().includes(s) || String(r.year ?? "").includes(s));
  }, [rows, search]);

  const sorted = useMemo(() => {
    const copy = filtered.slice();
    copy.sort((a: UioDetailRow, b: UioDetailRow) => {
      let c: number;
      if (sortCol === "product") c = a.product.localeCompare(b.product);
      else if (sortCol === "model") c = a.model.localeCompare(b.model);
      else if (sortCol === "year") c = (a.year ?? 0) - (b.year ?? 0);
      else c = a.units - b.units;
      if (c === 0) c = a.product.localeCompare(b.product) || a.model.localeCompare(b.model) || (a.year ?? 0) - (b.year ?? 0);
      return sortDir === "asc" ? c : -c;
    });
    return copy;
  }, [filtered, sortCol, sortDir]);

  const totalUnits = useMemo(() => filtered.reduce((s, r) => s + r.units, 0), [filtered]);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const pageRows = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function onSort(key: SortKey) {
    if (sortCol === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(key);
      setSortDir(key === "units" || key === "year" ? "desc" : "asc");
    }
    setPage(1);
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Detail UIO per Product, Model &amp; Tahun delivery</h2>
        <div className="panel-tools">
          <input
            className="search-input"
            placeholder="Cari product / model / tahun…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="empty-hint" style={{ margin: 0 }}>
          Belum ada Data UIO untuk filter ini.
        </div>
      ) : (
        <>
          <div className="table-scroll">
            <table className="data compact">
              <thead>
                <tr>
                  {COLS.map((c) => (
                    <th key={c.key} onClick={() => onSort(c.key)} style={{ textAlign: c.num ? "right" : "left" }}>
                      {c.label}
                      {sortCol === c.key && <span className="arrow">{sortDir === "asc" ? "▲" : "▼"}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={`${r.product}|${r.model}|${r.year ?? ""}`}>
                    <td>{r.product}</td>
                    <td>{r.model}</td>
                    <td style={{ textAlign: "right" }}>{r.year ?? "Tanpa tahun"}</td>
                    <td className="mono" style={{ textAlign: "right" }}>
                      {fmtInt(r.units)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} style={{ textAlign: "right", fontWeight: 600 }}>
                    Total unit{search.trim() ? " (hasil pencarian)" : ""}
                  </td>
                  <td className="mono" style={{ textAlign: "right", fontWeight: 600 }}>
                    {fmtInt(totalUnits)}
                  </td>
                </tr>
              </tfoot>
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
        </>
      )}
    </div>
  );
}
