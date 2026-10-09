"use client";

import { useMemo, useState } from "react";
import type { UseDashboardState } from "@/hooks/useDashboardState";
import { aggregateGroup, buildDetailRows, custKey, fmtInt, fmtIDRFull, fmtPct, uniq, type DetailRow, type GroupRow } from "@/lib/calculations";
import { FIELD_LABEL, type EditableField } from "@/lib/partsEdit";
import { MultiSelectField } from "@/components/FilterBar";
import { exportDetailToExcel, exportGroupToExcel } from "@/lib/exportDetail";

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
  const baseRows = state.detailRows;
  const { setData, data, filters } = state;
  const [search, setSearch] = useState("");
  const [fProduct, setFProduct] = useState<string[]>([]);
  const [fModel, setFModel] = useState<string[]>([]);
  const [fPartName, setFPartName] = useState<string[]>([]);
  const [cCode, setCCode] = useState<string[]>([]);
  const [cName, setCName] = useState<string[]>([]);
  const [cGroup, setCGroup] = useState<string[]>([]);
  const [cType, setCType] = useState<string[]>([]);
  const [view, setView] = useState<"group" | "part">("group");
  const [gSortCol, setGSortCol] = useState<keyof GroupRow>("amount_market_size");
  const [gSortDir, setGSortDir] = useState<"asc" | "desc">("desc");
  const [exporting, setExporting] = useState(false);
  const [sortCol, setSortCol] = useState<SortKey>("amount_market_size");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  const [editing, setEditing] = useState<{ id: number; field: EditableField; value: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // ---- Filter customer (Code, Name, Group, Type) ----
  // Pilihan saling mengikuti. Kalau ada yang dipilih, UIO & Actual Sales dihitung
  // ulang hanya dari customer terpilih, sehingga Market size & share ikut berubah.
  const customers = state.realCustomers;
  type Cust = (typeof customers)[number];
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
  const hasCustomerFilter = cCode.length + cName.length + cGroup.length + cType.length > 0;
  const customerKeys = useMemo(() => {
    if (!hasCustomerFilter) return null;
    const sel = { code: new Set(cCode), name: new Set(cName), group: new Set(cGroup), type: new Set(cType) };
    return new Set(
      customers
        .filter(
          (c) =>
            (sel.code.size === 0 || sel.code.has(c.customer_code || "")) &&
            (sel.name.size === 0 || sel.name.has(c.customer_name || "")) &&
            (sel.group.size === 0 || sel.group.has(c.customer_group || "")) &&
            (sel.type.size === 0 || sel.type.has(c.tier || ""))
        )
        .map((c) => custKey(c.customer_group, c.customer_name))
    );
  }, [hasCustomerFilter, customers, cCode, cName, cGroup, cType]);
  const rows = useMemo(
    () =>
      customerKeys
        ? buildDetailRows(data.parts, data.assumptions, data.uioUnits, data.priceList, data.customers, data.actualSalesTx, filters, customerKeys)
        : baseRows,
    [customerKeys, baseRows, data, filters]
  );

  // Pilihan filter bertingkat: Model unit mengikuti Product, Part name mengikuti
  // Product + Model unit. Dasarnya baris yang sudah lolos filter di bagian atas.
  const productOpts = useMemo(() => Array.from(new Set(baseRows.map((r) => r.product))).sort(), [baseRows]);
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

  // ---- Tampilan ringkas: satu baris per Customer Group ----
  const groupRows = useMemo(() => {
    if (view !== "group") return [] as GroupRow[];
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
    const ps = new Set(fProduct);
    const ms = new Set(fModel);
    const ns = new Set(fPartName);
    const out: GroupRow[] = [];
    byGroup.forEach((keys, g) => {
      const list = buildDetailRows(data.parts, data.assumptions, data.uioUnits, data.priceList, data.customers, data.actualSalesTx, filters, keys).filter(
        (r) => (ps.size === 0 || ps.has(r.product)) && (ms.size === 0 || ms.has(r.model)) && (ns.size === 0 || ns.has(r.part_name))
      );
      const agg = aggregateGroup(g, keys.size, list);
      if (agg.uio > 0 || agg.actual_sales > 0 || agg.amount_market_size > 0) out.push(agg);
    });
    return out;
  }, [view, customers, cCode, cName, cGroup, cType, data, filters, fProduct, fModel, fPartName]);

  const groupSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? groupRows.filter((g) => g.group.toLowerCase().includes(q)) : groupRows.slice();
    list.sort((a, b) => {
      const av = a[gSortCol] ?? 0;
      const bv = b[gSortCol] ?? 0;
      if (typeof av === "string" && typeof bv === "string") return gSortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return gSortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return list;
  }, [groupRows, search, gSortCol, gSortDir]);

  function onGroupSort(key: keyof GroupRow) {
    if (gSortCol === key) setGSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setGSortCol(key);
      setGSortDir("desc");
    }
    setPage(1);
  }

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

  const hasLocalFilter = fProduct.length + fModel.length + fPartName.length > 0 || hasCustomerFilter;

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

  const isGroup = view === "group";
  const totalCount = isGroup ? groupSorted.length : sorted.length;
  const pages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const pageRows = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const groupPageRows = groupSorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

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
    setCCode([]);
    setCName([]);
    setCGroup([]);
    setCType([]);
    setSearch("");
    setPage(1);
  }

  function filterNote(): string {
    const parts: string[] = [];
    if (fProduct.length) parts.push(`Product: ${fProduct.join(", ")}`);
    if (fModel.length) parts.push(`Model unit: ${fModel.join(", ")}`);
    if (fPartName.length) parts.push(`Part name: ${fPartName.join(", ")}`);
    if (cCode.length) parts.push(`Customer Code: ${cCode.join(", ")}`);
    if (cName.length) parts.push(`Customer Name: ${cName.join(", ")}`);
    if (cGroup.length) parts.push(`Customer Group: ${cGroup.join(", ")}`);
    if (cType.length) parts.push(`Customer Type: ${cType.join(", ")}`);
    if (search.trim()) parts.push(`Pencarian: ${search.trim()}`);
    return parts.join(" | ");
  }

  async function onExport() {
    if (exporting || totalCount === 0) return;
    setExporting(true);
    try {
      if (isGroup) await exportGroupToExcel(groupSorted, filterNote());
      else await exportDetailToExcel(sorted, filterNote());
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
        <h2>{isGroup ? "Summary per Customer Group" : "Detail part"}</h2>
        <div className="panel-tools">
          <div className="view-toggle" role="group" aria-label="Tampilan tabel">
            <button type="button" className={isGroup ? "active" : ""} onClick={() => { setView("group"); setPage(1); }}>
              Per Customer Group
            </button>
            <button type="button" className={!isGroup ? "active" : ""} onClick={() => { setView("part"); setPage(1); }}>
              Detail per part
            </button>
          </div>
          <button type="button" className="btn btn-ghost" disabled={exporting || totalCount === 0} onClick={onExport} title="Unduh baris yang sedang tampil (sesuai filter) sebagai Excel">
            {exporting ? "Menyiapkan…" : "⭳ Ekspor Excel"}
          </button>
          <input
            className="search-input"
            placeholder={isGroup ? "Cari customer group…" : "Cari part name / nomor part / model…"}
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
        <MultiSelectField label="Customer Code" values={cCode} options={customerOpts.code} onChange={(v) => { setCCode(v); setPage(1); }} />
        <MultiSelectField label="Customer Name" values={cName} options={customerOpts.name} onChange={(v) => { setCName(v); setPage(1); }} />
        <MultiSelectField label="Customer Group" values={cGroup} options={customerOpts.group} onChange={(v) => { setCGroup(v); setPage(1); }} />
        <MultiSelectField
          label="Customer Type"
          values={cType}
          options={customerOpts.type}
          onChange={(v) => { setCType(v); setPage(1); }}
          info="Klasifikasi key account customer (KA Nasional, KA Branch, NKA, Dealer, SHN, dst)."
        />
        <div className="detail-filters-info">
          <span>
            {isGroup ? `${groupSorted.length.toLocaleString("id-ID")} customer group` : `${sorted.length.toLocaleString("id-ID")} dari ${rows.length.toLocaleString("id-ID")} baris`}
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
      {isGroup ? (
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                {([
                  ["group", "Customer Group"],
                  ["customers", "Jumlah customer"],
                  ["uio", "UIO (unit)"],
                  ["qty_market_size", "Qty market size"],
                  ["amount_market_size", "Market size (Rp)"],
                  ["actual_qty", "Actual qty"],
                  ["actual_sales", "Actual sales (Rp)"],
                  ["market_share", "Market share"]
                ] as [keyof GroupRow, string][]).map(([k, label]) => (
                  <th key={k} onClick={() => onGroupSort(k)} style={{ cursor: "pointer" }} className={k === "qty_market_size" || k === "amount_market_size" || k === "market_share" ? "computed" : undefined}>
                    {label}
                    {gSortCol === k && <span className="arrow">{gSortDir === "asc" ? "▲" : "▼"}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groupPageRows.map((g) => (
                <tr key={g.group}>
                  <td>{g.group}</td>
                  <td>{fmtInt(g.customers)}</td>
                  <td>{fmtInt(g.uio)}</td>
                  <td className="computed">{fmtInt(g.qty_market_size)}</td>
                  <td className="computed">{fmtIDRFull(g.amount_market_size)}</td>
                  <td>{fmtInt(g.actual_qty)}</td>
                  <td>{fmtIDRFull(g.actual_sales)}</td>
                  <td className="computed">{fmtPct(g.market_share)}</td>
                </tr>
              ))}
              {groupSorted.length > 0 && (
                <tr style={{ fontWeight: 600 }}>
                  <td>TOTAL</td>
                  <td>{fmtInt(groupSorted.reduce((t, g) => t + g.customers, 0))}</td>
                  <td>{fmtInt(groupSorted.reduce((t, g) => t + g.uio, 0))}</td>
                  <td className="computed">{fmtInt(groupSorted.reduce((t, g) => t + g.qty_market_size, 0))}</td>
                  <td className="computed">{fmtIDRFull(groupSorted.reduce((t, g) => t + g.amount_market_size, 0))}</td>
                  <td>{fmtInt(groupSorted.reduce((t, g) => t + g.actual_qty, 0))}</td>
                  <td>{fmtIDRFull(groupSorted.reduce((t, g) => t + g.actual_sales, 0))}</td>
                  <td className="computed">
                    {fmtPct(
                      (() => {
                        const m = groupSorted.reduce((t, g) => t + g.period_market, 0);
                        return m > 0 ? groupSorted.reduce((t, g) => t + g.actual_sales, 0) / m : null;
                      })()
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
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
      )}
      <div className="pagination">
        <button disabled={currentPage <= 1} onClick={() => setPage((p) => p - 1)}>
          ‹ Sebelumnya
        </button>
        <span>
          Halaman {currentPage} / {pages} · {totalCount} {isGroup ? "group" : "baris"}
        </span>
        <button disabled={currentPage >= pages} onClick={() => setPage((p) => p + 1)}>
          Berikutnya ›
        </button>
      </div>

    </div>
  );
}
