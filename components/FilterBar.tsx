"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { UseDashboardState } from "@/hooks/useDashboardState";
import type { FilterState } from "@/lib/calculations";
import TraknusLogo from "@/components/TraknusLogo";

const CHIP_LABELS: Partial<Record<keyof FilterState, string>> = {
  tahun: "Tahun", bulan: "Bulan", area: "Area", sector: "Sector",
  customerGroup: "Customer group", customerName: "Customer name",
  pss: "PSS", tier: "Tier", product: "Product", modelUnit: "Model unit",
  partNumber: "Part number", partName: "Part name"
};

const MULTI_KEYS = Object.keys(CHIP_LABELS) as (keyof FilterState)[];

// Beberapa filter (mis. Part Number) bisa punya ribuan nilai unik — merender
// semuanya sekaligus sebagai elemen <label>/<input> bikin DOM meledak dan
// tab jadi tidak responsif. Batasi yang dirender; minta orang mengetik di
// kotak pencarian untuk mempersempit kalau hasilnya lebih banyak dari ini.
const MAX_RENDERED_OPTIONS = 300;

/** Dropdown checklist bergaya "pilih dulu, baru Terapkan":
 *  - Kotak tertutup menampilkan "All" / nama pilihan / "N dipilih".
 *  - Di panel: kotak cari, baris "(Pilih Semua)" (tri-state, berlaku untuk
 *    hasil pencarian yang sedang tampil), daftar centang, hitungan terpilih,
 *    dan tombol Batal / Terapkan. Pilihan baru berlaku setelah Terapkan.
 *  - Tekan Enter di kotak cari = pilih hanya hasil pencarian lalu Terapkan.
 *  - Kalau semua opsi tercentang saat Terapkan, filter disimpan kosong
 *    (= tanpa batasan / "All"), jadi tidak ada array ribuan nilai. */
export function MultiSelectField({
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
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);

  function openPanel() {
    // values kosong = "All" → semua opsi tercentang di panel.
    setDraft(new Set(values.length === 0 ? options : values));
    setSearch("");
    setOpen(true);
  }
  function closePanel() {
    setOpen(false);
    setSearch("");
  }

  // Klik di luar panel = Batal (pilihan sementara dibuang).
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) closePanel();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closePanel();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = useMemo(
    () => (search.trim() ? options.filter((o) => o.toLowerCase().includes(search.trim().toLowerCase())) : options),
    [options, search]
  );
  const visible = filtered.slice(0, MAX_RENDERED_OPTIONS);
  const hiddenCount = filtered.length - visible.length;

  const selectedInFiltered = filtered.reduce((n, o) => n + (draft.has(o) ? 1 : 0), 0);
  const allFilteredSelected = filtered.length > 0 && selectedInFiltered === filtered.length;
  const someFilteredSelected = selectedInFiltered > 0 && !allFilteredSelected;
  const allRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = someFilteredSelected;
  }, [someFilteredSelected, open]);

  function toggle(o: string) {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(o)) next.delete(o);
      else next.add(o);
      return next;
    });
  }
  function toggleAllFiltered() {
    setDraft((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filtered.forEach((o) => next.delete(o));
      else filtered.forEach((o) => next.add(o));
      return next;
    });
  }

  function apply(selection: Set<string>) {
    const chosen = options.filter((o) => selection.has(o));
    onChange(chosen.length === options.length ? [] : chosen);
    closePanel();
  }

  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (!search.trim() || filtered.length === 0) return;
    apply(new Set(filtered)); // hanya hasil pencarian, langsung diterapkan
  }

  const summary = values.length === 0 ? "All" : values.length <= 2 ? values.join(", ") : `${values.length.toLocaleString("id-ID")} dipilih`;

  return (
    <div className="field">
      <label>
        {label}
        {info && <span className="info-dot" title={info}>i</span>}
      </label>
      <div className="msf" ref={rootRef}>
        <button
          type="button"
          className={"msf-trigger" + (open ? " open" : "")}
          title={summary}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => (open ? closePanel() : openPanel())}
        >
          <span className="msf-trigger-text">{summary}</span>
          <span className="msf-chevron" aria-hidden="true">▾</span>
        </button>
        {open && (
          <div className="msf-panel">
            <div className="msf-searchwrap">
              <svg className="msf-searchicon" width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.8" />
                <path d="M14 14l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <input
                className="msf-search"
                placeholder="Cari… (Enter utk Terapkan)"
                value={search}
                autoFocus
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={onSearchKey}
              />
            </div>
            <div className="msf-list">
              <label className="msf-opt msf-opt-all">
                <input
                  ref={allRef}
                  type="checkbox"
                  checked={allFilteredSelected}
                  disabled={filtered.length === 0}
                  onChange={toggleAllFiltered}
                />
                <span>(Pilih Semua)</span>
              </label>
              {filtered.length === 0 && <div className="msf-empty">Tidak ada hasil</div>}
              {visible.map((o) => (
                <label className="msf-opt" key={o}>
                  <input type="checkbox" checked={draft.has(o)} onChange={() => toggle(o)} />
                  <span>{o}</span>
                </label>
              ))}
              {hiddenCount > 0 && (
                <div className="msf-empty">
                  +{hiddenCount.toLocaleString("id-ID")} hasil lain — ketik di kotak pencarian untuk mempersempit
                </div>
              )}
            </div>
            <div className="msf-foot">
              <span className="msf-count">{draft.size.toLocaleString("id-ID")} terpilih</span>
              <button type="button" className="msf-cancel" onClick={closePanel}>
                Batal
              </button>
              <button type="button" className="msf-apply" disabled={draft.size === 0} onClick={() => apply(draft)}>
                Terapkan
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function FilterBar({ state }: { state: UseDashboardState }) {
  const { filters, setFilter, resetFilters, options } = state;

  // Kalau satu filter punya banyak pilihan (mis. hasil "Pilih semua"),
  // chip-nya diringkas jadi satu — ribuan chip bikin halaman berat.
  const MAX_CHIPS_PER_FILTER = 5;
  const chipEntries: { key: keyof FilterState; label: string; value: string; all?: boolean }[] = [];
  MULTI_KEYS.forEach((k) => {
    const arr = filters[k] as string[];
    if (arr.length > MAX_CHIPS_PER_FILTER) {
      chipEntries.push({ key: k, label: CHIP_LABELS[k]!, value: `${arr.length.toLocaleString("id-ID")} dipilih`, all: true });
      return;
    }
    arr.forEach((value) => {
      chipEntries.push({ key: k, label: CHIP_LABELS[k]!, value });
    });
  });

  function removeChip(key: keyof FilterState, value: string, all?: boolean) {
    if (all) return setFilter(key, [] as FilterState[typeof key]);
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
            {chipEntries.map(({ key, label, value, all }) => (
              <span className="chip" key={`${key}-${value}`}>
                <span>
                  {label}: {value}
                </span>
                <button onClick={() => removeChip(key, value, all)}>✕</button>
              </span>
            ))}
          </div>
        )}

        <div className="filterbar-row">
          <MultiSelectField label="Tahun" values={filters.tahun} options={options.tahun} onChange={(v) => setFilter("tahun", v)} />
          <MultiSelectField label="Bulan" values={filters.bulan} options={options.bulan} onChange={(v) => setFilter("bulan", v)} />
          <MultiSelectField label="Area" values={filters.area} options={options.area} onChange={(v) => setFilter("area", v)} />
          <MultiSelectField
            label="Sector"
            values={filters.sector}
            options={options.sector}
            onChange={(v) => setFilter("sector", v)}
            info="Sektor industri customer (Plantation, Rental, Mining, dst). Satu customer bisa punya lebih dari satu sector."
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
