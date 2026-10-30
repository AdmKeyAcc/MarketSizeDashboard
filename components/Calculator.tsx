"use client";

import { useEffect, useMemo, useState } from "react";
import type { UseDashboardState } from "@/hooks/useDashboardState";
import type { useCalculatorSummary } from "@/hooks/useCalculatorSummary";
import { fmtIDRFull, fmtInt, uioYearsAvailable, uniq } from "@/lib/calculations";
import { calcPart, scopeCustomers, type CalcOverrides, type CalcResult } from "@/lib/calcEngine";
import { periodOf, sumPeriod } from "@/lib/period";
import { exportSummaryToExcel } from "@/lib/exportSummary";
import { MultiSelectField } from "@/components/FilterBar";
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
  money = false
}: {
  label: string;
  auto: number;
  value: NumOv;
  onChange: (v: NumOv) => void;
  autoNote: string;
  step?: number;
  decimals?: number;
  money?: boolean;
}) {
  const shown = value ?? Math.round(auto * 10 ** decimals) / 10 ** decimals;
  return (
    <div className="calc-field">
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
  const [year, setYear] = useState<number | null>(null);
  useEffect(() => {
    if (year === null || !uioYears.includes(year)) setYear(uioYears.length ? uioYears[uioYears.length - 1] : null);
  }, [uioYears, year]);
  const [bulan, setBulan] = useState<string[]>([]);
  const [group, setGroup] = useState("");
  const [custName, setCustName] = useState("");
  const groupOpts = useMemo(() => uniq(data.uioUnits.map((u) => (u.customer_group || "").trim())).filter(Boolean).sort(), [data.uioUnits]);
  const nameOpts = useMemo(
    () =>
      uniq(
        data.uioUnits
          .filter((u) => !group || (u.customer_group || "").trim().toUpperCase() === group.toUpperCase())
          .map((u) => (u.customer_name || "").trim())
      )
        .filter(Boolean)
        .sort(),
    [data.uioUnits, group]
  );

  // ---- data part (bisa diedit; kosong = nilai Master Part) ----
  const [pnEdit, setPnEdit] = useState<string | null>(null);
  const [qtyEdit, setQtyEdit] = useState<NumOv>(null);
  const [freqEdit, setFreqEdit] = useState<NumOv>(null);
  // ---- jam operasi / UIO / harga (kosong = otomatis) ----
  const [ov, setOv] = useState<CalcOverrides>({});
  const setO = (k: keyof CalcOverrides) => (v: NumOv) => setOv((p) => ({ ...p, [k]: v }));
  useEffect(() => {
    setPnEdit(null);
    setQtyEdit(null);
    setFreqEdit(null);
    setOv({});
  }, [partKey, product, model]);

  const part: Part | undefined = basePart && {
    ...basePart,
    part_number: pnEdit ?? basePart.part_number,
    qty_per_unit: qtyEdit ?? basePart.qty_per_unit,
    freq_replacement_hm: freqEdit ?? basePart.freq_replacement_hm
  };
  const partEdited = pnEdit !== null || qtyEdit !== null || freqEdit !== null;

  const custs = useMemo(
    () => scopeCustomers(data.uioUnits, data.priceList, { group, customer: custName }),
    [data.uioUnits, data.priceList, group, custName]
  );
  const scope = { year, group, customer: custName };
  const res: CalcResult | null = useMemo(
    () => (part ? calcPart(part, custs, data.priceList, scope, ov) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [part?.part_number, part?.qty_per_unit, part?.freq_replacement_hm, part?.hm_day, part?.product, part?.model, custs, data.priceList, year, group, custName, ov]
  );

  const months = periodOf(0, bulan, { year: null, month: null }).months;
  const nMonths = months ? months.length : 12;
  const periodLabel = months ? (months.length === 1 ? MONTH_ORDER[months[0]] : `${months.length} bulan`) : "setahun";
  const msPeriod = res ? sumPeriod(res.amountM, months, res.amount) : 0;
  const qtyPeriod = res ? sumPeriod(res.qtyM, months, res.qty) : 0;
  const scopeLabel = custName || group || "Semua customer";

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
      period: periodLabel,
      amountPeriod: sumPeriod(r.amountM, months, r.amount),
      qtyPeriod: sumPeriod(r.qtyM, months, r.qty),
      year,
      customerGroup: group,
      customerName: custName,
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

  return (
    <div className="panel">
      <h2>Kalkulator Market Size — satu part</h2>
      <div className="calc-note">
        Rumus dan data sama dengan Dashboard & Summary: dihitung per customer dari Data UIO, harga mengikuti Customer Group masing-masing
        (kontrak → non kontrak → pricelist). Angka di sini = angka Dashboard untuk filter yang sama. Isi kolom secara manual untuk simulasi.
      </div>

      <div className="calc-section-title">1. Part</div>
      <div className="calc-row">
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
        <div className="calc-field" style={{ flex: 2 }}>
          <label>Part ({fmtInt(partOptions.length)} part di model ini)</label>
          <select value={partKey} onChange={(e) => setPartKey(e.target.value)}>
            {partOptions.map((p, i) => (
              <option key={`${keyOf(p)}-${i}`} value={keyOf(p)}>
                {`${p.part_name} (${p.part_number})`}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="calc-section-title">2. Periode & customer</div>
      <div className="calc-row">
        <div className="calc-field">
          <label>Tahun (UIO sampai tahun)</label>
          <select value={year ?? ""} onChange={(e) => setYear(e.target.value ? Number(e.target.value) : null)}>
            {uioYears.length === 0 && <option value="">–</option>}
            {uioYears.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div className="calc-field calc-field-multi">
          <MultiSelectField
            label="Bulan"
            values={bulan}
            options={state.options.bulan}
            onChange={setBulan}
            info="Kosong = setahun. Market Size bulan terpilih mengikuti hari kerja kalender; unit baru dihitung mulai bulan belinya (Month Inv)."
          />
        </div>
        <div className="calc-field">
          <label>Customer Group</label>
          <select
            value={group}
            onChange={(e) => {
              setGroup(e.target.value);
              setCustName("");
            }}
          >
            <option value="">Semua</option>
            {groupOpts.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
        <div className="calc-field">
          <label>Customer</label>
          <select value={custName} onChange={(e) => setCustName(e.target.value)}>
            <option value="">Semua</option>
            {nameOpts.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      {basePart && res && (
        <>
          <div className="calc-section-title">
            3. Data part <span className="calc-section-sub">dari Master Part</span>
            {partEdited && (
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setPnEdit(null);
                  setQtyEdit(null);
                  setFreqEdit(null);
                }}
              >
                ↺ kembalikan ke Master Part
              </button>
            )}
          </div>
          <div className="calc-row">
            <div className="calc-field">
              <label>Part Number</label>
              <input type="text" className={pnEdit !== null ? "manual" : undefined} value={part!.part_number || ""} onChange={(e) => setPnEdit(e.target.value)} />
              <div className="calc-hint">Menentukan harga (Data Harga)</div>
            </div>
            <div className="calc-field">
              <label>Qty per unit</label>
              <input type="number" min={0} className={qtyEdit !== null ? "manual" : undefined} value={part!.qty_per_unit} onChange={(e) => setQtyEdit(Number(e.target.value) || 0)} />
            </div>
            <div className="calc-field">
              <label>Frekuensi ganti (HM)</label>
              <input type="number" min={1} className={freqEdit !== null ? "manual" : undefined} value={part!.freq_replacement_hm} onChange={(e) => setFreqEdit(Number(e.target.value) || 1)} />
            </div>
          </div>

          <div className="calc-section-title">
            4. Unit & jam operasi <span className="calc-section-sub">rata-rata dari Data UIO {year !== null ? `s/d ${year}` : ""} · {scopeLabel}</span>
          </div>
          <div className="calc-row">
            <AutoField label="UIO (unit)" auto={res.uioAuto} value={ov.uio ?? null} onChange={setO("uio")} decimals={0} autoNote={`${fmtInt(res.customers)} customer`} />
            <AutoField label="HM / Day" auto={res.avg.hmDay} value={ov.hmDay ?? null} onChange={setO("hmDay")} step={0.5} autoNote={noUnits ? "Master Part / default" : "rata-rata Data UIO"} />
            <AutoField label="Day / Month" auto={res.avg.dayMonth} value={ov.dayMonth ?? null} onChange={setO("dayMonth")} autoNote={noUnits ? "default" : "rata-rata Data UIO"} />
            <AutoField label="Month / Year" auto={res.avg.monthYear} value={ov.monthYear ?? null} onChange={setO("monthYear")} autoNote={noUnits ? "default" : "rata-rata Data UIO"} />
          </div>

          <div className="calc-section-title">5. Harga</div>
          <div className="calc-row" style={{ maxWidth: 520 }}>
            <AutoField
              label="Harga per pcs (Rp)"
              auto={res.priceAuto}
              value={ov.price ?? null}
              onChange={setO("price")}
              decimals={0}
              money
              autoNote={res.priceLabel + (res.priceSources.contract + res.priceSources.non_contract + res.priceSources.pricelist > 1 ? " · rata-rata tertimbang" : "")}
            />
          </div>

          {noUnits && !ov.uio && (
            <div className="hier-note" style={{ margin: "0 0 10px" }}>
              Tidak ada unit {product} {model} di Data UIO untuk pilihan ini (s/d {year ?? "–"}, {scopeLabel}), jadi Market Size = 0. Ubah tahun / customer, atau isi UIO
              manual untuk simulasi.
            </div>
          )}

          <div className="formula-flow">
            <div className="formula-step">
              <div className="fs-label">Annual HM / unit</div>
              <div className="fs-value">{fmtInt(res.annualHm)}</div>
            </div>
            <div className="formula-op">× UIO {fmtInt(res.uio)} ÷ Frek {fmtInt(part!.freq_replacement_hm)} × Qty {fmtDec(part!.qty_per_unit, 2)} →</div>
            <div className="formula-step">
              <div className="fs-label">Qty setahun</div>
              <div className="fs-value">{fmtInt(res.qty)}</div>
            </div>
            <div className="formula-op">×</div>
            <div className="formula-step">
              <div className="fs-label">Harga</div>
              <div className="fs-value">{fmtIDRFull(res.price)}</div>
            </div>
            <div className="formula-op">=</div>
            <div className="formula-result">
              <div className="fs-label">Market Size setahun</div>
              <div className="fs-value">{fmtIDRFull(res.amount)}</div>
            </div>
          </div>
          <div className="calc-period">
            {months && (
              <div>
                <span className="fs-label">Market Size {periodLabel}</span>
                <b>{fmtIDRFull(msPeriod)}</b>
                <span className="muted"> · qty {fmtDec(qtyPeriod, 1)}</span>
              </div>
            )}
            <div>
              <span className="fs-label">Rata-rata / bulan</span>
              <b>{fmtIDRFull(msPeriod / nMonths)}</b>
            </div>
          </div>
          {res.customers > 1 && !ov.uio && (
            <div className="calc-hint" style={{ marginTop: 6 }}>
              Qty dibulatkan per customer (sama dengan Dashboard), jadi Qty setahun bisa sedikit berbeda dari Annual HM × UIO ÷ Frek × Qty yang dihitung
              sekaligus.
            </div>
          )}

          <details className="calc-months">
            <summary>Rincian per bulan</summary>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th></th>
                    {MONTH_ORDER.map((m, i) => (
                      <th key={m} className={months && months.includes(i) ? "sel" : undefined}>
                        {m.slice(0, 3)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Qty</td>
                    {Array.from(res.qtyM).map((q, i) => (
                      <td key={i} className={months && months.includes(i) ? "sel" : undefined}>
                        {fmtDec(q, 1)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Market Size (Rp)</td>
                    {Array.from(res.amountM).map((a, i) => (
                      <td key={i} className={"mono" + (months && months.includes(i) ? " sel" : "")}>
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

      <div className="btn-row" style={{ alignItems: "center" }}>
        <button className="btn btn-primary" onClick={addThis} disabled={!res}>
          + Tambah part ini ke daftar
        </button>
        <button
          className="btn btn-ghost"
          onClick={addAllModel}
          disabled={!res || partOptions.length === 0}
          title="Hitung semua part model ini dengan periode, customer, dan isian unit/jam operasi yang sama (harga otomatis per part)."
        >
          + Tambah semua part {model} ({fmtInt(partOptions.length)})
        </button>
        {flash && <span className="added-flash">{flash}</span>}
      </div>
    </div>
  );
}

function AddedPartsSummary({ summaryState }: { summaryState: SummaryState }) {
  const { items, removeItem, clearAll } = summaryState;
  const [exporting, setExporting] = useState(false);
  const total = items.reduce((s, it) => s + (it.amountMarketSize || 0), 0);
  const totalPeriod = items.reduce((s, it) => s + (it.amountPeriod ?? it.amountMarketSize ?? 0), 0);
  const samePeriod = new Set(items.map((it) => it.period || "setahun")).size === 1;

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
                  <th>Tahun</th>
                  <th>Customer</th>
                  <th>UIO</th>
                  <th>Annual HM / unit</th>
                  <th>Frek (HM)</th>
                  <th>Qty / unit</th>
                  <th>Qty setahun</th>
                  <th>Harga</th>
                  <th>Market Size setahun</th>
                  <th>Periode</th>
                  <th>Market Size periode</th>
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
                    <td>{it.year ?? "–"}</td>
                    <td>{it.customerName || it.customerGroup || "Semua"}</td>
                    <td>{fmtInt(it.uio)}</td>
                    <td>{fmtInt(it.annualHm)}</td>
                    <td>{fmtInt(it.freqReplacementHm)}</td>
                    <td>{fmtDec(it.qtyPerUnit, 2)}</td>
                    <td>{fmtInt(it.qtyMarketSize)}</td>
                    <td title={it.priceSource || ""}>{fmtIDRFull(it.contractPrice)}</td>
                    <td className="mono">{fmtIDRFull(it.amountMarketSize)}</td>
                    <td>{it.period || "setahun"}</td>
                    <td className="mono">{fmtIDRFull(it.amountPeriod ?? it.amountMarketSize)}</td>
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
                  <td colSpan={12} style={{ textAlign: "right", fontWeight: 600 }}>
                    Total
                  </td>
                  <td className="mono" style={{ fontWeight: 600 }}>
                    {fmtIDRFull(total)}
                  </td>
                  <td></td>
                  <td className="mono" style={{ fontWeight: 600 }} title={samePeriod ? "" : "Periode antar baris berbeda"}>
                    {samePeriod ? fmtIDRFull(totalPeriod) : "periode berbeda"}
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
