"use client";

import { useEffect, useMemo, useState } from "react";
import type { UseDashboardState } from "@/hooks/useDashboardState";
import type { useCalculatorSummary } from "@/hooks/useCalculatorSummary";
import { fmtIDRFull, fmtInt, uioYearsAvailable, uniq } from "@/lib/calculations";
import { calcPart, scopeCustomers, type CalcOverrides, type CalcResult } from "@/lib/calcEngine";
import { exportSummaryToExcel } from "@/lib/exportSummary";
import { MONTH_ORDER, type CalcSummaryItem, type Part } from "@/lib/types";

type SummaryState = ReturnType<typeof useCalculatorSummary>;
type NumOv = number | null;

const fmtDec = (n: number, d = 1) => n.toLocaleString("id-ID", { maximumFractionDigits: d });
const keyOf = (p: Part) => `${p.part_number || ""}¦${p.part_name}`;

/** Input angka dengan nilai otomatis + kemungkinan diisi manual ("pakai otomatis" untuk kembali). */
function AutoField({
  label,
  auto,
  value,
  onChange,
  autoNote,
  step = 1,
  decimals = 1,
  money = false,
  className = ""
}: {
  label: string;
  auto: number;
  value: NumOv;
  onChange: (v: NumOv) => void;
  autoNote: string;
  step?: number;
  decimals?: number;
  money?: boolean;
  className?: string;
}) {
  const shown = value ?? Math.round(auto * 10 ** decimals) / 10 ** decimals;
  return (
    <div className={`calc-field ${className}`}>
      <label>{label}</label>
      <input
        type="number"
        min={0}
        step={step}
        value={Number.isFinite(shown) ? shown : 0}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className={value !== null ? "manual" : undefined}
      />
      <div className="calc-hint">
        {value !== null ? (
          <>
            Manual · otomatis: {money ? fmtIDRFull(auto) : fmtDec(auto, decimals)}{" "}
            <button type="button" className="link-btn" onClick={() => onChange(null)}>
              pakai otomatis
            </button>
          </>
        ) : (
          autoNote
        )}
      </div>
    </div>
  );
}

function QuickCalculator({ state, summaryState }: { state: UseDashboardState; summaryState: SummaryState }) {
  const { data } = state;

  // ---- part ----
  const products = useMemo(() => uniq(data.parts.map((p) => p.product)).sort(), [data.parts]);
  const [product, setProduct] = useState(products[0] || "");
  const models = useMemo(() => uniq(data.parts.filter((p) => p.product === product).map((p) => p.model)).sort(), [data.parts, product]);
  const [model, setModel] = useState(models[0] || "");
  const partOptions = useMemo(() => data.parts.filter((p) => p.product === product && p.model === model), [data.parts, product, model]);
  const [partKey, setPartKey] = useState("");
  const basePart = partOptions.find((p) => keyOf(p) === partKey);

  useEffect(() => {
    if (!products.includes(product)) setProduct(products[0] || "");
  }, [products, product]);
  useEffect(() => {
    if (!models.includes(model)) setModel(models[0] || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models]);
  useEffect(() => {
    if (!partOptions.some((p) => keyOf(p) === partKey)) setPartKey(partOptions[0] ? keyOf(partOptions[0]) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partOptions]);

  // ---- konteks (sama dengan filter Dashboard / Summary) ----
  const uioYears = useMemo(() => uioYearsAvailable(data.uioUnits), [data.uioUnits]);
  // Hitung cepat: selalu populasi UIO terbaru (semua unit s/d tahun terakhir di Data UIO).
  const year = uioYears.length ? uioYears[uioYears.length - 1] : null;

  // ---- data part (bisa diedit; kosong = nilai Master Part) ----
  const [qtyEdit, setQtyEdit] = useState<NumOv>(null);
  const [freqEdit, setFreqEdit] = useState<NumOv>(null);
  // ---- jam operasi / UIO / harga (kosong = otomatis) ----
  const [ov, setOv] = useState<CalcOverrides>({});
  const setO = (k: keyof CalcOverrides) => (v: NumOv) => setOv((p) => ({ ...p, [k]: v }));
  useEffect(() => {
    setQtyEdit(null);
    setFreqEdit(null);
    setOv({});
  }, [partKey, product, model]);

  const part: Part | undefined = basePart && {
    ...basePart,
    qty_per_unit: qtyEdit ?? basePart.qty_per_unit,
    freq_replacement_hm: freqEdit ?? basePart.freq_replacement_hm
  };
  // Semua customer (hitung per customer, sama dengan total Dashboard); harga otomatis per Customer Group masing-masing.
  const custs = useMemo(() => scopeCustomers(data.uioUnits, data.priceList, { group: "", customer: "" }), [data.uioUnits, data.priceList]);
  const scope = { year, group: "", customer: "" };
  const res: CalcResult | null = useMemo(
    () => (part ? calcPart(part, custs, data.priceList, scope, ov) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [part?.part_number, part?.qty_per_unit, part?.freq_replacement_hm, part?.hm_day, part?.product, part?.model, custs, data.priceList, year, ov]
  );


  const [flash, setFlash] = useState("");
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(""), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  function toItem(p: Part, r: CalcResult): Omit<CalcSummaryItem, "id" | "addedAt"> {
    return {
      product: p.product,
      model: p.model,
      partName: p.part_name,
      partNumber: p.part_number || null,
      qtyPerUnit: p.qty_per_unit,
      freqReplacementHm: p.freq_replacement_hm,
      hmDay: ov.hmDay ?? r.avg.hmDay,
      dayMonth: ov.dayMonth ?? r.avg.dayMonth,
      monthYear: ov.monthYear ?? r.avg.monthYear,
      uio: r.uio,
      customers: r.customers,
      annualHm: r.annualHm,
      qtyMarketSize: r.qty,
      contractPrice: r.price,
      amountMarketSize: r.amount,
      period: "setahun",
      amountPeriod: r.amount,
      qtyPeriod: r.qty,
      year,
      priceSource: r.priceLabel
    };
  }

  function addThis() {
    if (!part || !res) return;
    summaryState.addItem(toItem(part, res));
    setFlash("✓ Part ditambahkan ke daftar di bawah");
  }
  function addAllModel() {
    // Semua part model ini dengan konteks & isian jam operasi / UIO yang sama (harga tetap otomatis per part).
    const { price: _p, ...ovNoPrice } = ov;
    let n = 0;
    partOptions.forEach((p) => {
      const r = calcPart(p, custs, data.priceList, scope, ovNoPrice);
      summaryState.addItem(toItem(p, r));
      n++;
    });
    setFlash(`✓ ${n} part ${model} ditambahkan ke daftar`);
  }

  const noUnits = !!res && res.uioAuto === 0;
  // Keterangan harga singkat (satu baris) supaya baris field tetap sejajar.
  const priceNote = (() => {
    if (!res) return "";
    const ps = res.priceSources;
    const kinds = [ps.contract && `${ps.contract} kontrak`, ps.non_contract && `${ps.non_contract} non kontrak`, ps.pricelist && `${ps.pricelist} pricelist`].filter(
      Boolean
    ) as string[];
    return kinds.length > 1 ? `Rata-rata · ${kinds.join(", ")}` : res.priceLabel;
  })();

  return (
    <div className="panel calc">
      <div className="panel-head">
        <h2>Kalkulator Market Size — satu part</h2>
      </div>

      {/* ---------- Input ---------- */}
      <div className="calc-grid">
        <div className="calc-field">
          <label>Product</label>
          <select value={product} onChange={(e) => setProduct(e.target.value)}>
            {products.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="calc-field">
          <label>Model unit</label>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="calc-field span-2">
          <label>Part · {fmtInt(partOptions.length)} part di model ini</label>
          <select value={partKey} onChange={(e) => setPartKey(e.target.value)}>
            {partOptions.map((p, i) => (
              <option key={`${keyOf(p)}-${i}`} value={keyOf(p)}>
                {`${p.part_name} (${p.part_number})`}
              </option>
            ))}
          </select>
        </div>
      </div>

      {basePart && res && (
        <>
          <div className="calc-grid calc-grid-inputs">
            <AutoField label="UIO (unit)" auto={res.uioAuto} value={ov.uio ?? null} onChange={setO("uio")} decimals={0} autoNote={`Data UIO${year !== null ? ` s/d ${year}` : ""} · ${fmtInt(res.customers)} customer`} />
            <AutoField label="HM / Day" auto={res.avg.hmDay} value={ov.hmDay ?? null} onChange={setO("hmDay")} step={0.5} autoNote={noUnits ? "Master Part / default" : "rata-rata Data UIO"} />
            <AutoField label="Day / Month" auto={res.avg.dayMonth} value={ov.dayMonth ?? null} onChange={setO("dayMonth")} autoNote={noUnits ? "default" : "rata-rata Data UIO"} />
            <AutoField label="Month / Year" auto={res.avg.monthYear} value={ov.monthYear ?? null} onChange={setO("monthYear")} autoNote={noUnits ? "default" : "rata-rata Data UIO"} />

            <AutoField label="Qty per unit" auto={basePart.qty_per_unit} value={qtyEdit} onChange={setQtyEdit} decimals={2} autoNote="dari Master Part" />
            <AutoField label="Frekuensi ganti (HM)" auto={basePart.freq_replacement_hm} value={freqEdit} onChange={setFreqEdit} decimals={0} autoNote="dari Master Part" />
            <AutoField label="Harga per pcs (Rp)" className="span-2" auto={res.priceAuto} value={ov.price ?? null} onChange={setO("price")} decimals={0} money autoNote={priceNote} />
          </div>

          {noUnits && !ov.uio && (
            <div className="hier-note" style={{ margin: "4px 0 12px" }}>
              Tidak ada unit {product} {model} di Data UIO, jadi Market Size = 0. Isi UIO manual untuk simulasi.
            </div>
          )}

          {/* ---------- Hasil ---------- */}
          <div className="calc-result">
            <div className="calc-stat">
              <div className="cs-label">Annual HM / unit</div>
              <div className="cs-value">{fmtInt(res.annualHm)}</div>
              <div className="cs-sub">jam operasi setahun</div>
            </div>
            <div className="calc-stat">
              <div className="cs-label">Qty setahun</div>
              <div className="cs-value">{fmtInt(res.qty)} pcs</div>
              <div className="cs-sub">≈ {fmtDec(res.qty / 12, 1)} pcs / bulan</div>
            </div>
            <div className="calc-stat">
              <div className="cs-label">Harga per pcs</div>
              <div className="cs-value">{fmtIDRFull(res.price)}</div>
              <div className="cs-sub">{ov.price != null ? "diisi manual" : res.customers > 1 ? "rata-rata tertimbang" : res.priceLabel}</div>
            </div>
            <div className="calc-stat main">
              <div className="cs-label">Market Size setahun</div>
              <div className="cs-value">{fmtIDRFull(res.amount)}</div>
              <div className="cs-sub">≈ {fmtIDRFull(res.amount / 12)} / bulan</div>
            </div>
          </div>
          <div className="calc-formula">
            Rumus: {fmtInt(res.annualHm)} jam × {fmtInt(res.uio)} unit ÷ {fmtInt(part!.freq_replacement_hm)} HM × {fmtDec(part!.qty_per_unit, 2)} pcs ={" "}
            {fmtDec(part!.freq_replacement_hm > 0 ? (res.annualHm * res.uio * part!.qty_per_unit) / part!.freq_replacement_hm : 0, 1)} → <b>{fmtInt(res.qty)} pcs</b>{" "}
            × {fmtIDRFull(res.price)} = <b>{fmtIDRFull(res.amount)}</b> setahun
            {res.customers > 1 && !ov.uio && <span className="muted"> · qty dibulatkan per customer, sama dengan Dashboard</span>}
          </div>

          <details className="calc-months">
            <summary>Rincian per bulan</summary>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th></th>
                    {MONTH_ORDER.map((m, i) => (
                      <th key={m}>
                        {m.slice(0, 3)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Qty</td>
                    {Array.from(res.qtyM).map((q, i) => (
                      <td key={i}>
                        {fmtDec(q, 1)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Market Size (Rp)</td>
                    {Array.from(res.amountM).map((a, i) => (
                      <td key={i} className="mono">
                        {fmtIDRFull(a)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}

      <div className="calc-actions">
        {flash && <span className="added-flash">{flash}</span>}
        <button
          className="btn btn-ghost"
          onClick={addAllModel}
          disabled={!res || partOptions.length === 0}
          title="Hitung semua part model ini dengan periode, customer, dan isian unit/jam operasi yang sama (harga otomatis per part)."
        >
          + Tambah semua part {model} ({fmtInt(partOptions.length)})
        </button>
        <button className="btn btn-primary" onClick={addThis} disabled={!res}>
          + Tambah part ini ke daftar
        </button>
      </div>
    </div>
  );
}

function AddedPartsSummary({ summaryState }: { summaryState: SummaryState }) {
  const { items, removeItem, clearAll } = summaryState;
  const [exporting, setExporting] = useState(false);
  const total = items.reduce((s, it) => s + (it.amountMarketSize || 0), 0);

  async function handleExport() {
    if (items.length === 0 || exporting) return;
    setExporting(true);
    try {
      await exportSummaryToExcel(items);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Daftar part yang dicek {items.length > 0 && <span className="count-badge">{items.length}</span>}</h2>
      </div>

      {items.length === 0 ? (
        <div className="empty-hint" style={{ margin: 0 }}>
          Belum ada part. Gunakan <b>“+ Tambah part ini ke daftar”</b> atau <b>“+ Tambah semua part”</b> di atas untuk mengumpulkan beberapa part, lalu ekspor
          sekaligus ke Excel.
        </div>
      ) : (
        <>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Model</th>
                  <th>Part Name</th>
                  <th>Part Number</th>
                  <th>UIO</th>
                  <th>Annual HM / unit</th>
                  <th>Frek (HM)</th>
                  <th>Qty / unit</th>
                  <th>Qty setahun</th>
                  <th>Harga</th>
                  <th>Market Size setahun</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td>{it.product}</td>
                    <td>{it.model}</td>
                    <td>{it.partName}</td>
                    <td>{it.partNumber || "–"}</td>
                    <td>{fmtInt(it.uio)}</td>
                    <td>{fmtInt(it.annualHm)}</td>
                    <td>{fmtInt(it.freqReplacementHm)}</td>
                    <td>{fmtDec(it.qtyPerUnit, 2)}</td>
                    <td>{fmtInt(it.qtyMarketSize)}</td>
                    <td title={it.priceSource || ""}>{fmtIDRFull(it.contractPrice)}</td>
                    <td className="mono">{fmtIDRFull(it.amountMarketSize)}</td>
                    <td>
                      <button className="row-remove-btn" title="Hapus dari daftar" onClick={() => removeItem(it.id)}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={10} style={{ textAlign: "right", fontWeight: 600 }}>
                    Total
                  </td>
                  <td className="mono" style={{ fontWeight: 600 }}>
                    {fmtIDRFull(total)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={handleExport} disabled={exporting}>
              {exporting ? "Menyiapkan file…" : "Ekspor ke Excel"}
            </button>
            <button className="btn btn-ghost" onClick={clearAll}>
              Kosongkan daftar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function Calculator({ state, summaryState }: { state: UseDashboardState; summaryState: SummaryState }) {
  return (
    <>
      <QuickCalculator state={state} summaryState={summaryState} />
      <AddedPartsSummary summaryState={summaryState} />
    </>
  );
}
