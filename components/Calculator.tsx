"use client";

import { useMemo, useState, useEffect } from "react";
import type { UseDashboardState } from "@/hooks/useDashboardState";
import type { useCalculatorSummary } from "@/hooks/useCalculatorSummary";
import {
  computePartMarketSize,
  fmtIDRFull,
  fmtInt,
  fmtPct,
  uioYearsAvailable,
  uniq
} from "@/lib/calculations";
import { resolvePriceInfo, uioCountForPart } from "@/lib/calcHelpers";
import { exportSummaryToExcel } from "@/lib/exportSummary";
import type { Part } from "@/lib/types";

type SummaryState = ReturnType<typeof useCalculatorSummary>;

function QuickCalculator({ state, summaryState }: { state: UseDashboardState; summaryState: SummaryState }) {
  const { data } = state;

  const products = useMemo(() => uniq(data.parts.map((p) => p.product)).sort(), [data.parts]);
  const [product, setProduct] = useState(products[0] || "");
  const models = useMemo(
    () => uniq(data.parts.filter((p) => p.product === product).map((p) => p.model)).sort(),
    [data.parts, product]
  );
  const [model, setModel] = useState(models[0] || "");
  const partOptions = useMemo(
    () => data.parts.filter((p) => p.product === product && p.model === model),
    [data.parts, product, model]
  );
  const [partKey, setPartKey] = useState<string>("");
  const keyOf = (p: Part) => `${p.part_number || ""}¦${p.part_name}`;
  const selectedPart: Part | undefined = partOptions.find((p) => keyOf(p) === partKey);

  // ---- konteks UIO: tahun + (opsional) satu Customer Group / Customer, sama seperti filter di Dashboard ----
  const uioYears = useMemo(() => uioYearsAvailable(data.uioUnits), [data.uioUnits]);
  const [year, setYear] = useState<number | null>(uioYears.length ? uioYears[uioYears.length - 1] : null);
  useEffect(() => {
    if (year === null || !uioYears.includes(year)) setYear(uioYears.length ? uioYears[uioYears.length - 1] : null);
  }, [uioYears, year]);
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

  // Semua field di bawah ini boleh diedit langsung per part.
  const [partName, setPartName] = useState("");
  const [partNumber, setPartNumber] = useState("");
  const [qtyPerUnit, setQtyPerUnit] = useState(0);
  const [pricelist, setPricelist] = useState(0);
  const [freq, setFreq] = useState(1);
  const [hmDay, setHmDay] = useState(8);
  const [uio, setUio] = useState(0);
  const [uioManual, setUioManual] = useState(false);
  const [price, setPrice] = useState(0);
  const [priceManual, setPriceManual] = useState(false);

  useEffect(() => {
    if (!products.includes(product)) setProduct(products[0] || "");
  }, [products, product]);
  useEffect(() => {
    setModel(models[0] || "");
  }, [models]);
  useEffect(() => {
    const first = data.parts.find((p) => p.product === product && p.model === model);
    setPartKey(first ? keyOf(first) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.parts, product, model]);
  useEffect(() => {
    if (!selectedPart) return;
    setPartName(selectedPart.part_name);
    setPartNumber(selectedPart.part_number || "");
    setQtyPerUnit(selectedPart.qty_per_unit);
    setPricelist(selectedPart.pricelist);
    setFreq(selectedPart.freq_replacement_hm || 1);
    // HM/hari mengikuti Master Part (sama dengan perhitungan Dashboard & Summary); baku 8 kalau kosong.
    setHmDay(selectedPart.hm_day || 8);
    setPriceManual(false);
    setUioManual(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPart?.part_number, selectedPart?.part_name, product, model]);

  // UIO otomatis dari Data UIO (kumulatif sampai tahun terpilih), kecuali diisi manual.
  const autoUio = useMemo(
    () => uioCountForPart(data.uioUnits, year, product, model, group, custName),
    [data.uioUnits, year, product, model, group, custName]
  );
  useEffect(() => {
    if (!uioManual) setUio(autoUio);
  }, [autoUio, uioManual]);

  // Harga otomatis: kontrak group → Non Kontrak per part number → Pricelist Master Part.
  const priceInfo = useMemo(
    () => resolvePriceInfo(data.priceList, partNumber || null, group, pricelist),
    [data.priceList, partNumber, group, pricelist]
  );
  useEffect(() => {
    if (!priceManual) setPrice(priceInfo.price);
  }, [priceInfo.price, priceManual]);

  const workdaysMonth = data.assumptions.find((a) => a.product === product)?.workdays_month || 22;
  const annualHm = hmDay * workdaysMonth * 12;
  const { qty: qtyMarketSize, amount: amountMarketSize } = computePartMarketSize({
    annualHm,
    freqReplacementHm: freq,
    qtyPerUnit,
    uio,
    price
  });
  const effectiveDiscount = pricelist > 0 ? Math.max(0, 1 - price / pricelist) : 0;
  const priceSourceLabel = priceManual ? "Diisi manual" : priceInfo.label;

  const [justAdded, setJustAdded] = useState(false);
  useEffect(() => {
    if (!justAdded) return;
    const t = setTimeout(() => setJustAdded(false), 2200);
    return () => clearTimeout(t);
  }, [justAdded]);

  function handleAddToSummary() {
    if (!partName) return;
    summaryState.addItem({
      product,
      model,
      partName,
      partNumber: partNumber || null,
      qtyPerUnit,
      pricelist,
      freqReplacementHm: freq,
      hmDay,
      uio,
      discount: effectiveDiscount,
      annualHm,
      qtyMarketSize,
      contractPrice: price,
      amountMarketSize,
      year,
      customerGroup: group,
      customerName: custName,
      priceSource: priceSourceLabel
    });
    setJustAdded(true);
  }

  return (
    <div className="panel">
      <h2>Kalkulator cepat — satu part</h2>
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
        <div className="calc-field">
          <label>Part</label>
          <select value={partKey} onChange={(e) => setPartKey(e.target.value)}>
            {partOptions.map((p, i) => (
              <option key={`${keyOf(p)}-${i}`} value={keyOf(p)}>
                {`${p.part_name} (${p.part_number})`}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="calc-row">
        <div className="calc-field">
          <label>Tahun (UIO sampai tahun)</label>
          <select value={year ?? ""} onChange={(e) => { setYear(e.target.value ? Number(e.target.value) : null); setUioManual(false); }}>
            {uioYears.length === 0 && <option value="">–</option>}
            {uioYears.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div className="calc-field">
          <label>Customer Group</label>
          <select value={group} onChange={(e) => { setGroup(e.target.value); setCustName(""); setUioManual(false); }}>
            <option value="">Semua (populasi total)</option>
            {groupOpts.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
        <div className="calc-field">
          <label>Customer</label>
          <select value={custName} onChange={(e) => { setCustName(e.target.value); setUioManual(false); }}>
            <option value="">Semua</option>
            {nameOpts.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="calc-row">
        <div className="calc-field">
          <label>Part Name</label>
          <input type="text" value={partName} onChange={(e) => setPartName(e.target.value)} />
        </div>
        <div className="calc-field">
          <label>Part Number</label>
          <input type="text" value={partNumber} onChange={(e) => { setPartNumber(e.target.value); setPriceManual(false); }} />
        </div>
      </div>
      <div className="calc-row">
        <div className="calc-field">
          <label>Qty per unit</label>
          <input type="number" min={0} value={qtyPerUnit} onChange={(e) => setQtyPerUnit(Number(e.target.value) || 0)} />
        </div>
        <div className="calc-field">
          <label>Pricelist (Rp)</label>
          <input type="number" min={0} value={pricelist} onChange={(e) => setPricelist(Number(e.target.value) || 0)} />
        </div>
        <div className="calc-field">
          <label>Frekuensi ganti (HM)</label>
          <input type="number" min={1} value={freq} onChange={(e) => setFreq(Number(e.target.value) || 1)} />
        </div>
        <div className="calc-field">
          <label>HM / hari</label>
          <input type="number" min={0} step={0.5} value={hmDay} onChange={(e) => setHmDay(Number(e.target.value) || 0)} />
        </div>
        <div className="calc-field">
          <label>UIO (unit)</label>
          <input type="number" min={0} value={uio} onChange={(e) => { setUio(Number(e.target.value) || 0); setUioManual(true); }} />
          <div className="calc-hint">
            {uioManual ? (
              <>
                Manual · Data UIO: {fmtInt(autoUio)} unit{" "}
                <button type="button" className="link-btn" onClick={() => setUioManual(false)}>pakai Data UIO</button>
              </>
            ) : (
              <>Dari Data UIO{year !== null ? ` sampai ${year}` : ""}{custName ? ` · ${custName}` : group ? ` · ${group}` : ""}</>
            )}
          </div>
        </div>
        <div className="calc-field">
          <label>Harga dipakai (Rp)</label>
          <input type="number" min={0} value={price} onChange={(e) => { setPrice(Number(e.target.value) || 0); setPriceManual(true); }} />
          <div className="calc-hint">
            {priceManual ? (
              <>
                Manual · otomatis: {fmtIDRFull(priceInfo.price)}{" "}
                <button type="button" className="link-btn" onClick={() => setPriceManual(false)}>pakai otomatis</button>
              </>
            ) : (
              <>{priceInfo.label}{pricelist > 0 && priceInfo.source !== "pricelist" ? ` · diskon ${fmtPct(effectiveDiscount)}` : ""}</>
            )}
          </div>
        </div>
      </div>
      {data.uioUnits.length > 0 && uio === 0 && !uioManual && (
        <div className="hier-note" style={{ margin: "0 0 10px" }}>
          Tidak ada unit {product} {model} di Data UIO untuk pilihan ini, jadi UIO = 0 dan Market Size = 0. Ubah tahun / customer, atau isi UIO manual.
        </div>
      )}
      <div className="formula-flow">
        <div className="formula-step">
          <div className="fs-label">Annual HM</div>
          <div className="fs-value">{fmtInt(annualHm)}</div>
        </div>
        <div className="formula-op">→</div>
        <div className="formula-step">
          <div className="fs-label">Qty market size</div>
          <div className="fs-value">{fmtInt(qtyMarketSize)}</div>
        </div>
        <div className="formula-op">×</div>
        <div className="formula-step">
          <div className="fs-label">Harga</div>
          <div className="fs-value">{fmtIDRFull(price)}</div>
        </div>
        <div className="formula-op">=</div>
        <div className="formula-result">
          <div className="fs-label">Amount market size</div>
          <div className="fs-value">{fmtIDRFull(amountMarketSize)}</div>
        </div>
      </div>
      <div className="btn-row" style={{ alignItems: "center" }}>
        <button className="btn btn-primary" onClick={handleAddToSummary} disabled={!partName}>
          + Tambah part ini ke daftar
        </button>
        {justAdded && <span className="added-flash">✓ Ditambahkan ke daftar di bawah</span>}
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
          Belum ada part yang ditambahkan. Gunakan tombol <b>“+ Tambah part ini ke daftar”</b> di kalkulator cepat di
          atas untuk mengumpulkan beberapa part di sini, lalu ekspor semuanya sekaligus ke Excel.
        </div>
      ) : (
        <>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Model</th>
                  <th>Tahun</th>
                  <th>Customer</th>
                  <th>Part Name</th>
                  <th>Part Number</th>
                  <th>Qty/Unit</th>
                  <th>Pricelist</th>
                  <th>Freq (HM)</th>
                  <th>HM/Day</th>
                  <th>UIO</th>
                  <th>Diskon efektif</th>
                  <th>Annual HM</th>
                  <th>Qty MS</th>
                  <th>Harga</th>
                  <th>Amount MS</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td>{it.product}</td>
                    <td>{it.model}</td>
                    <td>{it.year ?? "–"}</td>
                    <td>{it.customerName || it.customerGroup || "Semua"}</td>
                    <td>{it.partName}</td>
                    <td>{it.partNumber || "–"}</td>
                    <td>{fmtInt(it.qtyPerUnit)}</td>
                    <td>{fmtIDRFull(it.pricelist)}</td>
                    <td>{fmtInt(it.freqReplacementHm)}</td>
                    <td>{fmtInt(it.hmDay)}</td>
                    <td>{fmtInt(it.uio)}</td>
                    <td>{fmtPct(it.discount)}</td>
                    <td>{fmtInt(it.annualHm)}</td>
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
                  <td colSpan={15} style={{ textAlign: "right", fontWeight: 600 }}>
                    Total Amount Market Size
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
