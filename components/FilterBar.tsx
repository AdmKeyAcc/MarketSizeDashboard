"use client";

import { useState } from "react";
import type { UseDashboardState } from "@/hooks/useDashboardState";
import type { FilterState } from "@/lib/calculations";
import TraknusLogo from "@/components/TraknusLogo";

const CHIP_LABELS: Partial<Record<keyof FilterState, string>> = {
  tahun: "Tahun", bulan: "Bulan", area: "Area", businessArea: "Business area",
  customerGroup: "Customer group", customerName: "Customer name",
  pss: "PSS", tier: "Tier", product: "Product", modelUnit: "Model unit",
  partNumber: "Part number", partName: "Part name"
};

const MULTI_KEYS = Object.keys(CHIP_LABELS) as (keyof FilterState)[];

/** Compact checklist dropdown: the closed box stays the same size as a
 * normal <select>, and only the option panel (small, scrollable, with a
 * search box for long lists) opens below it — never a big list taking up
 * page space. */
function MultiSelectField({
  label,
  values,
  options,
  onChange,
  info
}: {
  label: string;
  values: string[];
  options: string[];
  onChange: (next: string[]) => void;
  info?: string;
}) {
  const [search, setSearch] = useState("");
  const filtered = search.trim()
    ? options.filter((o) => o.toLowerCase().includes(search.trim().toLowerCase()))
    : options;

  function toggle(o: string) {
    onChange(values.includes(o) ? values.filter((v) => v !== o) : [...values, o]);
  }

  const summary = values.length === 0 ? "Semua" : values.length <= 2 ? values.join(", ") : `${values.length} dipilih`;

  return (
    <div className="field">
      <label>
        {label}
        {info && <span className="info-dot" title={info}>i</span>}
      </label>
      <details className="msf">
        <summary title={summary}>{summary}</summary>
        <div className="msf-panel">
          {options.length > 8 && (
            <input
              className="msf-search"
              placeholder="Cari…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
          <div className="msf-list">
            {filtered.length === 0 && <div className="msf-empty">Tidak ada hasil</div>}
            {filtered.map((o) => (
              <label className="msf-opt" key={o}>
                <input type="checkbox" checked={values.includes(o)} onChange={() => toggle(o)} />
                <span>{o}</span>
              </label>
            ))}
          </div>
          {values.length > 0 && (
            <button type="button" className="msf-clear" onClick={() => onChange([])}>
              Hapus pilihan
            </button>
          )}
        </div>
      </details>
    </div>
  );
}

export default function FilterBar({ state }: { state: UseDashboardState }) {
  const { filters, setFilter, resetFilters, options } = state;

  const chipEntries: { key: keyof FilterState; label: string; value: string }[] = [];
  MULTI_KEYS.forEach((k) => {
    (filters[k] as string[]).forEach((value) => {
      chipEntries.push({ key: k, label: CHIP_LABELS[k]!, value });
    });
  });

  function removeChip(key: keyof FilterState, value: string) {
    const arr = filters[key] as string[];
    setFilter(key, arr.filter((v) => v !== value) as FilterState[typeof key]);
  }

  return (
    <div className="filter-card-wrap">
      <div className="filter-card">
        <div className="filter-card-head">
          <div className="filter-card-title">
            <TraknusLogo size={40} />
            <div>
              <h1>Market Size Dashboard</h1>
              <p>Dashboard market size untuk memantau perbandingan dengan actual sales.</p>
            </div>
          </div>
          <button className="link-btn" onClick={resetFilters}>
            Reset semua
          </button>
        </div>

        <div className="filter-card-divider" />

        {chipEntries.length > 0 && (
          <div className="chips">
            {chipEntries.map(({ key, label, value }) => (
              <span className="chip" key={`${key}-${value}`}>
                <span>
                  {label}: {value}
                </span>
                <button onClick={() => removeChip(key, value)}>✕</button>
              </span>
            ))}
          </div>
        )}

        <div className="filterbar-row">
          <MultiSelectField label="Tahun" values={filters.tahun} options={options.tahun} onChange={(v) => setFilter("tahun", v)} />
          <MultiSelectField label="Bulan" values={filters.bulan} options={options.bulan} onChange={(v) => setFilter("bulan", v)} />
          <MultiSelectField label="Area (Cabang)" values={filters.area} options={options.area} onChange={(v) => setFilter("area", v)} />
          <MultiSelectField
            label="Business Area"
            values={filters.businessArea}
            options={options.businessArea}
            onChange={(v) => setFilter("businessArea", v)}
            info="Pengelompokan awal berdasarkan lini produk TRAKNUS — mohon dikonfirmasi ke tim terkait."
          />
          <MultiSelectField
            label="Customer Group"
            values={filters.customerGroup}
            options={options.customerGroup}
            onChange={(v) => setFilter("customerGroup", v)}
          />
          <MultiSelectField
            label="Customer Name"
            values={filters.customerName}
            options={options.customerName}
            onChange={(v) => setFilter("customerName", v)}
          />
          <MultiSelectField label="PSS" values={filters.pss} options={options.pss} onChange={(v) => setFilter("pss", v)} />
          <MultiSelectField label="Tier" values={filters.tier} options={options.tier} onChange={(v) => setFilter("tier", v)} />
          <MultiSelectField label="Product" values={filters.product} options={options.product} onChange={(v) => setFilter("product", v)} />
          <MultiSelectField
            label="Model Unit"
            values={filters.modelUnit}
            options={options.modelUnit}
            onChange={(v) => setFilter("modelUnit", v)}
          />
          <MultiSelectField
            label="Part Number"
            values={filters.partNumber}
            options={options.partNumber}
            onChange={(v) => setFilter("partNumber", v)}
          />
          <MultiSelectField
            label="Part Name"
            values={filters.partName}
            options={options.partName}
            onChange={(v) => setFilter("partName", v)}
            info="Diambil dari kolom Description pada data part."
          />
        </div>
      </div>
    </div>
  );
}
