"use client";

import { useMemo, useState } from "react";
import type { UseDashboardState } from "@/hooks/useDashboardState";
import { fmtInt, fmtIDRFull } from "@/lib/calculations";

type SortKey =
  | "product" | "model" | "part_name" | "part_number"
  | "hm_day" | "uio_scaled" | "qty_market_size_scaled" | "amount_market_size_scaled";

const COLS: { key: SortKey; label: string; computed?: boolean }[] = [
  { key: "product", label: "Product" },
  { key: "model", label: "Model unit" },
  { key: "part_name", label: "Part name" },
  { key: "part_number", label: "Part number" },
  { key: "hm_day", label: "HM/Day" },
  { key: "uio_scaled", label: "UIO (qty)" },
  { key: "qty_market_size_scaled", label: "Qty market size", computed: true },
  { key: "amount_market_size_scaled", label: "Market size (Rp)", computed: true }
];

const PAGE_SIZE = 20;

export default function DetailTable({ state }: { state: UseDashboardState }) {
  const { rows } = state;
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<SortKey>("amount_market_size_scaled");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        (r.part_name || "").toLowerCase().includes(s) ||
        (r.part_number || "").toLowerCase().includes(s) ||
        (r.model || "").toLowerCase().includes(s)
    );
  }, [rows, search]);

  const sorted = useMemo(() => {
    const copy = filtered.slice();
    copy.sort((a, b) => {
      const av = a[sortCol];
      const bv = b[sortCol];
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = (av as number) || 0;
      const bn = (bv as number) || 0;
      return sortDir === "asc" ? an - bn : bn - an;
    });
    return copy;
  }, [filtered, sortCol, sortDir]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const pageRows = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function onSort(key: SortKey) {
    if (sortCol === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(key);
      setSortDir("desc");
    }
    setPage(1);
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Detail part</h2>
        <input
          className="search-input"
          placeholder="Cari part name / nomor part / model…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              {COLS.map((col) => (
                <th
                  key={col.key}
                  className={col.computed ? "computed" : undefined}
                  onClick={() => onSort(col.key)}
                  style={{ cursor: "pointer" }}
                >
                  {col.label}
                  {sortCol === col.key && <span className="arrow">{sortDir === "asc" ? "▲" : "▼"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => {
              const key = `${row.product}|${row.model}|${row.part_number}`;
              return (
                <tr key={key}>
                  <td>{row.product}</td>
                  <td>{row.model}</td>
                  <td>{row.part_name}</td>
                  <td>{row.part_number}</td>
                  <td>{fmtInt(row.hm_day)}</td>
                  <td>{fmtInt(row.uio_scaled)}</td>
                  <td className="computed">{fmtInt(row.qty_market_size_scaled)}</td>
                  <td className="computed">{fmtIDRFull(row.amount_market_size_scaled)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="pagination">
        <button disabled={currentPage <= 1} onClick={() => setPage((p) => p - 1)}>
          ‹ Sebelumnya
        </button>
        <span>
          Halaman {currentPage} / {pages} · {sorted.length} baris
        </span>
        <button disabled={currentPage >= pages} onClick={() => setPage((p) => p + 1)}>
          Berikutnya ›
        </button>
      </div>
    </div>
  );
}
