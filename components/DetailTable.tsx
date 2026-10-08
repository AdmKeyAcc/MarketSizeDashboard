"use client";

import { useMemo, useState } from "react";
import type { UseDashboardState } from "@/hooks/useDashboardState";
import { fmtInt, fmtIDRFull, fmtPct, type DetailRow } from "@/lib/calculations";
import { FIELD_LABEL, type EditableField } from "@/lib/partsEdit";
import { MultiSelectField } from "@/components/FilterBar";
import { exportDetailToExcel } from "@/lib/exportDetail";

type SortKey = Exclude<keyof DetailRow, "uio_source" | "part_id">;

const COLS: { key: SortKey; label: string; computed?: boolean; editable?: EditableField }[] = [
  { key: "product", label: "Product" },
  { key: "model", label: "Model unit" }, 
  { key: "part_name", label: "Part name" },
  { key: "part_number", label: "Part number" },
  { key: "hm_day", label: "HM/Day", editable: "hm_day" },
  { key: "annual_hm", label: "Annual HM" },
  { key: "freq_replacement_hm", label: "Frekuensi ganti (HM)", editable: "freq_replacement_hm" },
  { key: "qty_per_unit", label: "Qty per unit", editable: "qty_per_unit" },
  { key: "uio", label: "UIO" },
  { key: "price", label: "Price (Rp)", editable: "price" },
  { key: "qty_market_size", label: "Qty market size", computed: true },
  { key: "amount_market_size", label: "Market size (Rp)", computed: true },
  { key: "actual_qty", label: "Actual qty" },
  { key: "actual_sales", label: "Actual sales (Rp)" },
  { key: "market_share", label: "Market share", computed: true }
];

const PAGE_SIZE = 20;
export default function DetailTable({ state }: { state: UseDashboardState }) {
  const rows = state.detailRows;
  const { setData } = state;
  const [search, setSearch] = useState("");
  const [fProduct, setFProduct] = useState<string[]>([]);
  const [fModel, setFModel] = useState<string[]>([]);
  const [fPartName, setFPartName] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [sortCol, setSortCol] = useState<SortKey>("amount_market_size");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  const [editing, setEditing] = useState<{ id: number; field: EditableField; value: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Pilihan filter bertingkat: Model unit mengikuti Product, Part name mengikuti
  // Product + Model unit. Dasarnya baris yang sudah lolos filter di bagian atas.
  const productOpts = useMemo(() => Array.from(new Set(rows.map((r) => r.product))).sort(), [rows]);
  const modelOpts = useMemo(() => {
    const ps = new Set(fProduct);
    return Array.from(new Set(rows.filter((r) => ps.size === 0 || ps.has(r.product)).map((r) => r.model))).sort();
  }, [rows, fProduct]);
  const partNameOpts = useMemo(() => {
    const ps = new Set(fProduct);
    const ms = new Set(fModel);
    return Array.from(
      new Set(
        rows
          .filter((r) => (ps.size === 0 || ps.has(r.product)) && (ms.size === 0 || ms.has(r.model)))
          .map((r) => r.part_name)
      )
    ).sort();
  }, [rows, fProduct, fModel]);

  const localFiltered = useMemo(() => {
    const ps = new Set(fProduct);
    const ms = new Set(fModel);
    const ns = new Set(fPartName);
    return rows.filter(
      (r) =>
        (ps.size === 0 || ps.has(r.product)) &&
        (ms.size === 0 || ms.has(r.model)) &&
        (ns.size === 0 || ns.has(r.part_name))
    );
  }, [rows, fProduct, fModel, fPartName]);

  const hasLocalFilter = fProduct.length + fModel.length + fPartName.length > 0;

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return localFiltered;
    return localFiltered.filter(
      (r) =>
        (r.part_name || "").toLowerCase().includes(s) ||
        (r.part_number || "").toLowerCase().includes(s) ||
        (r.model || "").toLowerCase().includes(s)
    );
  }, [localFiltered, search]);

  const sorted = useMemo(() => {
    const copy = filtered.slice();
    copy.sort((a, b) => {
      const av = a[sortCol] ?? "";
      const bv = b[sortCol] ?? "";
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

  function changeProduct(next: string[]) {
    setFProduct(next);
    // Buang pilihan Model / Part name yang tidak lagi tersedia untuk Product baru.
    const ps = new Set(next);
    const avail = rows.filter((r) => ps.size === 0 || ps.has(r.product));
    const models = new Set(avail.map((r) => r.model));
    const names = new Set(avail.map((r) => r.part_name));
    setFModel((m) => m.filter((x) => models.has(x)));
    setFPartName((n) => n.filter((x) => names.has(x)));
    setPage(1);
  }
  function changeModel(next: string[]) {
    setFModel(next);
    const ps = new Set(fProduct);
    const ms = new Set(next);
    const names = new Set(
      rows.filter((r) => (ps.size === 0 || ps.has(r.product)) && (ms.size === 0 || ms.has(r.model))).map((r) => r.part_name)
    );
    setFPartName((n) => n.filter((x) => names.has(x)));
    setPage(1);
  }
  function changePartName(next: string[]) {
    setFPartName(next);
    setPage(1);
  }
  function resetLocalFilters() {
    setFProduct([]);
    setFModel([]);
    setFPartName([]);
    setSearch("");
    setPage(1);
  }

  function filterNote(): string {
    const parts: string[] = [];
    if (fProduct.length) parts.push(`Product: ${fProduct.join(", ")}`);
    if (fModel.length) parts.push(`Model unit: ${fModel.join(", ")}`);
    if (fPartName.length) parts.push(`Part name: ${fPartName.join(", ")}`);
    if (search.trim()) parts.push(`Pencarian: ${search.trim()}`);
    return parts.join(" | ");
  }

  async function onExport() {
    if (exporting || sorted.length === 0) return;
    setExporting(true);
    try {
      await exportDetailToExcel(sorted, filterNote());
    } catch {
      setMessage({ type: "err", text: "Gagal membuat file ekspor." });
    } finally {
      setExporting(false);
    }
  }

  function onSort(key: SortKey) {
    if (sortCol === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(key);
      setSortDir("desc");
    }
    setPage(1);
  }

  function startEdit(row: DetailRow, field: EditableField) {
    if (saving || row.part_id === undefined) return;
    setMessage(null);
    setEditing({ id: row.part_id, field, value: String(row[field]) });
  }

  async function commitEdit(row: DetailRow) {
    if (!editing || saving) return;
    const { field, value } = editing;
    const num = Number(value);
    if (value.trim() === "" || !Number.isFinite(num)) {
      setMessage({ type: "err", text: "Nilai harus berupa angka." });
      setEditing(null);
      return;
    }
    if (num === row[field]) {
      setEditing(null);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/parts/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partId: row.part_id, changes: { [field]: num } })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Gagal menyimpan.");
      if (json.unchanged) {
        setEditing(null);
        return;
      }
      // Perbarui data di layar langsung (tanpa reload) — semua KPI & chart ikut berubah.
      setData((prev) => ({
        ...prev,
        parts: prev.parts.map((p) =>
          p.id === row.part_id
            ? { ...p, ...(field !== "price" ? { [field]: num } : {}) }
            : p
        ),
        priceList:
          field === "price" && row.part_number
            ? [
                ...prev.priceList.filter((x) => !(x.part_number === row.part_number && !x.customer_group)),
                { part_number: row.part_number, customer_group: "", price: num }
              ]
            : prev.priceList
      }));
      setMessage({ type: "ok", text: `${FIELD_LABEL[field]} untuk ${row.part_name} (${row.model}) disimpan.` });
      setEditing(null);
    } catch (e) {
      setMessage({ type: "err", text: e instanceof Error ? e.message : "Gagal menyimpan." });
    } finally {
      setSaving(false);
    }
  }

  function renderCell(row: DetailRow, col: (typeof COLS)[number]) {
    const field = col.editable;
    const display =
      field === "price" ? fmtIDRFull(row.price) : fmtInt(row[col.key as keyof DetailRow] as number);
    if (!field) return display;
    const isEditing = editing && editing.id === row.part_id && editing.field === field;
    if (isEditing) {
      return (
        <input
          className="cell-input"
          type="number"
          step="any"
          min={0}
          autoFocus
          disabled={saving}
          value={editing.value}
          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
          onBlur={() => commitEdit(row)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditing(null);
          }}
        />
      );
    }
    return (
      <button type="button" className="cell-edit" title="Klik untuk mengubah" onClick={() => startEdit(row, field)}>
        {display}
      </button>
    );
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Detail part</h2>
        <div className="panel-tools">
          <button type="button" className="btn btn-ghost" disabled={exporting || sorted.length === 0} onClick={onExport} title="Unduh baris yang sedang tampil (sesuai filter) sebagai Excel">
            {exporting ? "Menyiapkan…" : "⭳ Ekspor Excel"}
          </button>
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
      </div>
      <div className="detail-filters">
        <MultiSelectField label="Product" values={fProduct} options={productOpts} onChange={changeProduct} />
        <MultiSelectField label="Model unit" values={fModel} options={modelOpts} onChange={changeModel} />
        <MultiSelectField label="Part name" values={fPartName} options={partNameOpts} onChange={changePartName} />
        <div className="detail-filters-info">
          <span>
            {sorted.length.toLocaleString("id-ID")} dari {rows.length.toLocaleString("id-ID")} baris
          </span>
          {(hasLocalFilter || search.trim() !== "") && (
            <button type="button" className="link-btn" onClick={resetLocalFilters}>
              Reset filter tabel
            </button>
          )}
        </div>
      </div>
      {message && (
        <div className={`upload-status ${message.type === "ok" ? "ok" : "err"}`} style={{ marginBottom: 8 }}>
          {message.text}
        </div>
      )}
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              {COLS.map((col) => (
                <th
                  key={col.key}
                  className={col.computed ? "computed" : col.editable ? "editable" : undefined}
                  onClick={() => onSort(col.key)}
                  style={{ cursor: "pointer" }}
                >
                  {col.label}
                  {col.editable && <span title="Kolom ini bisa diedit"> ✎</span>}
                  {sortCol === col.key && <span className="arrow">{sortDir === "asc" ? "▲" : "▼"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => {
              const key = `${row.part_id ?? ""}|${row.product}|${row.model}|${row.part_number}|${i}`;
              return (
                <tr key={key}>
                  <td>{row.product}</td>
                  <td>{row.model}</td>
                  <td>{row.part_name}</td>
                  <td>{row.part_number}</td>
                  <td className="editable-cell">{renderCell(row, COLS[4])}</td>
                  <td>{fmtInt(row.annual_hm)}</td>
                  <td className="editable-cell">{renderCell(row, COLS[6])}</td>
                  <td className="editable-cell">{renderCell(row, COLS[7])}</td>
                  <td title={row.uio_source === "template" ? "UIO dari template kalkulator (belum ada Data UIO untuk model ini)" : "UIO dari Data UIO"}>
                    {fmtInt(row.uio)}
                    {row.uio_source === "template" && "*"}
                  </td>
                  <td className="editable-cell">{renderCell(row, COLS[9])}</td>
                  <td className="computed">{fmtInt(row.qty_market_size)}</td>
                  <td className="computed">{fmtIDRFull(row.amount_market_size)}</td>
                  <td>{fmtInt(row.actual_qty)}</td>
                  <td>{fmtIDRFull(row.actual_sales)}</td>
                  <td className="computed">{fmtPct(row.market_share)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="chart-note">
        Qty market size = ROUND(Annual HM ÷ Frekuensi ganti × Qty per unit × UIO) · Market size (Rp) = Price × Qty market size
        · Price dari Data Harga (fallback pricelist part) · UIO dari Data UIO per Product + Model unit · Actual dari
        Actual Sales per part pada tahun acuan (tahun terbesar di filter Tahun, atau tahun terbaru) · Market share = Actual sales ÷ Market size periode yang sama.
        {rows.some((r) => r.uio_source === "template") && " * = UIO dari template kalkulator (model ini belum ada di Data UIO)."}
        {" "}Kolom bertanda ✎ bisa diedit dengan klik angkanya; perubahan langsung tersimpan permanen di database dan berlaku untuk semua pengguna.
        Price yang diedit disimpan sebagai harga umum part tersebut.
      </p>
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
