"use client";

import { useMemo, useState } from "react";
import type { UseDashboardState } from "@/hooks/useDashboardState";
import { fmtInt } from "@/lib/calculations";
import type { UioUnit } from "@/lib/types";

type Col = { key: string; label: string; num?: boolean; get: (u: UioUnit) => string | number | null };

// Urutan kolom = urutan kolom di template upload Data UIO.
const COLS: Col[] = [
  { key: "branch", label: "Branch", get: (u) => u.branch },
  { key: "pss_name", label: "Pss Name", get: (u) => u.pss_name ?? null },
  { key: "customer_code", label: "Cust. Code", get: (u) => u.customer_code ?? null },
  { key: "customer_name", label: "Cust. Name", get: (u) => u.customer_name },
  { key: "customer_group", label: "Cust. Group", get: (u) => u.customer_group },
  { key: "customer_type", label: "Cust. Type", get: (u) => u.customer_type ?? null },
  { key: "product", label: "Product", get: (u) => u.product },
  { key: "model", label: "Model", get: (u) => u.model },
  { key: "serial_number", label: "Serial Number", get: (u) => u.serial_number },
  { key: "year", label: "Year Inv", num: true, get: (u) => u.year },
  { key: "month_inv", label: "Month Inv", num: true, get: (u) => u.month_inv ?? null },
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
