"use client";

import { useMemo, useState, useEffect } from "react";
import type { UseDashboardState } from "@/hooks/useDashboardState";
import type { useCalculatorSummary } from "@/hooks/useCalculatorSummary";
import {
  canonicalProduct,
  computeQuickRow,
  custKey,
  defaultDiscount,
  defaultHmDay,
  defaultUioQty,
  fmtIDRFull,
  fmtInt,
  fmtPct,
  normModel as normModelKey,
  uniq
} from "@/lib/calculations";
import { exportSummaryToExcel } from "@/lib/exportSummary";
import type { Part } from "@/lib/types";
import DetailTable from "@/components/DetailTable";
import { MultiSelectField } from "@/components/FilterBar";

type SummaryState = ReturnType<typeof useCalculatorSummary>;

function QuickCalculator({ state, summaryState }: { state: UseDashboardState; summaryState: SummaryState }) {
  const { data } = state;

  // ---- Filter customer (Customer Code, Name, Group, Type/Tier) ----
  // Kosong = semua customer. Kalau ada yang dipilih, UIO di kalkulator dihitung
  // hanya dari unit milik customer terpilih.
  const [cCode, setCCode] = useState<string[]>([]);
  const [cName, setCName] = useState<string[]>([]);
  const [cGroup, setCGroup] = useState<string[]>([]);
  const [cType, setCType] = useState<string[]>([]);
  const customers = state.realCustomers;
  const customerOpts = useMemo(() => {
    const sel = { code: new Set(cCode), name: new Set(cName), group: new Set(cGroup), type: new Set(cType) };
    const ok = (c: (typeof customers)[number], skip: "code" | "name" | "group" | "type") =>
      (skip === "code" || sel.code.size === 0 || sel.code.has(c.customer_code || "")) &&
      (skip === "name" || sel.name.size === 0 || sel.name.has(c.customer_name || "")) &&
      (skip === "group" || sel.group.size === 0 || sel.group.has(c.customer_group || "")) &&
      (skip === "type" || sel.type.size === 0 || sel.type.has(c.tier || ""));
    const list = (skip: "code" | "name" | "group" | "type", pick: (c: (typeof customers)[number]) => string | null) =>
      uniq(customers.filter((c) => ok(c, skip)).map(pick)).sort();
    return {
      code: list("code", (c) => c.customer_code),
      name: list("name", (c) => c.customer_name),
      group: list("group", (c) => c.customer_group),
      type: list("type", (c) => c.tier)
    };
  }, [customers, cCode, cName, cGroup, cType]);
  const hasCustomerFilter = cCode.length + cName.length + cGroup.length + cType.length > 0;
  const customerUnits = useMemo(() => {
    if (!hasCustomerFilter) return data.uioUnits;
    const sel = { code: new Set(cCode), name: new Set(cName), group: new Set(cGroup), type: new Set(cType) };
    const keys = new Set(
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
    return data.uioUnits.filter((u) => keys.has(custKey(u.customer_group, u.customer_name)));
  }, [hasCustomerFilter, data.uioUnits, customers, cCode, cName, cGroup, cType]);
  const customerNote = useMemo(() => {
    const parts: string[] = [];
    const j = (label: string, a: string[]) => a.length && parts.push(`${label}: ${a.length > 3 ? `${a.length} dipilih` : a.join(", ")}`);
    j("Code", cCode);
    j("Name", cName);
    j("Group", cGroup);
    j("Type", cType);
    return parts.join(" | ");
  }, [cCode, cName, cGroup, cType]);

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
  const [partLabel, setPartLabel] = useState<string>("");
  const selectedPart: Part | undefined = partOptions.find((p) => `${p.part_name} (${p.part_number})` === partLabel);

  // Semua field di bawah ini diedit langsung per part — tidak ada lagi
  // tabel "Asumsi per model unit" / "Diskon per brand" yang dibagi bersama.
  const [partName, setPartName] = useState("");
  const [partNumber, setPartNumber] = useState("");
  const [qtyPerUnit, setQtyPerUnit] = useState(0);
  const [pricelist, setPricelist] = useState(0);
  const [freq, setFreq] = useState(1);
  const [hmDay, setHmDay] = useState(8);
  const [uio, setUio] = useState(0);
  const [discountPct, setDiscountPct] = useState(50);

  useEffect(() => {
    if (!products.includes(product)) setProduct(products[0] || "");
  }, [products, product]);
  useEffect(() => {
    setModel(models[0] || "");
  }, [models]);
  useEffect(() => {
    const opts = data.parts.filter((p) => p.product === product && p.model === model);
    const first = opts[0];
    setPartLabel(first ? `${first.part_name} (${first.part_number})` : "");
  }, [data.parts, product, model]);
  useEffect(() => {
    if (!model || !product) return;
    // Default HM/Day = 8 (bisa diubah manual). UIO default dari Data UIO
    // (populasi riil tahun terbaru) kalau ada, fallback ke uio_master.
    setHmDay(defaultHmDay(state.modelLookup, model));
    setDiscountPct(Math.round(defaultDiscount(data.assumptions, product) * 100));
  }, [product, model, state.modelLookup, data.assumptions]);
  // UIO terpisah supaya mengubah filter customer tidak mereset HM/hari & diskon.
  // Tanpa filter customer: seperti biasa (fallback ke template kalau model tak
  // punya unit). Dengan filter customer: murni hitungan unit milik customer itu.
  useEffect(() => {
    if (!model || !product) return;
    if (!hasCustomerFilter) {
      setUio(defaultUioQty(state.modelLookup, data.uioUnits, product, model));
      return;
    }
    const prod = canonicalProduct(product);
    const mod = normModelKey(model);
    setUio(customerUnits.filter((u) => canonicalProduct(u.product) === prod && normModelKey(u.model) === mod).length);
  }, [product, model, state.modelLookup, data.uioUnits, hasCustomerFilter, customerUnits]);
  useEffect(() => {
    if (!selectedPart) return;
    setPartName(selectedPart.part_name);
    setPartNumber(selectedPart.part_number || "");
    setQtyPerUnit(selectedPart.qty_per_unit);
    setPricelist(selectedPart.pricelist);
    setFreq(selectedPart.freq_replacement_hm || 1);
  }, [selectedPart?.part_number]);

  const discount = Math.max(0, Math.min(100, discountPct)) / 100;
  const { annualHm, qtyMarketSize, contractPrice, amountMarketSize } = computeQuickRow({
    qtyPerUnit,
    pricelist,
    freqReplacementHm: freq,
    hmDay,
    uio,
    discount,
    workdaysMonth: data.assumptions.find((a) => a.product === product)?.workdays_month || 22
  });

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
      discount,
      annualHm,
      qtyMarketSize,
      contractPrice,
      amountMarketSize,
      customer: customerNote || undefined
    });
    setJustAdded(true);
  }

  return (
    <div className="panel">
      <h2>Kalkulator cepat — satu part</h2>
      <div className="detail-filters four" style={{ marginBottom: 6 }}>
        <MultiSelectField label="Customer Code" values={cCode} options={customerOpts.code} onChange={setCCode} />
        <MultiSelectField label="Customer Name" values={cName} options={customerOpts.name} onChange={setCName} />
        <MultiSelectField label="Customer Group" values={cGroup} options={customerOpts.group} onChange={setCGroup} />
        <MultiSelectField
          label="Customer Type"
          values={cType}
          options={customerOpts.type}
          onChange={setCType}
          info="Klasifikasi key account customer (KA Nasional, KA Branch, NKA, Dealer, SHN, dst)."
        />
      </div>
      <p className="note" style={{ margin: "0 0 12px" }}>
        {hasCustomerFilter
          ? "UIO di bawah dihitung hanya dari unit milik customer yang dipilih (masih bisa diubah manual)."
          : "Pilih customer (opsional) untuk menghitung UIO khusus customer tersebut. Kosong = semua customer."}
      </p>
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
          <select value={partLabel} onChange={(e) => setPartLabel(e.target.value)}>
            {partOptions.map((p) => {
              const label = `${p.part_name} (${p.part_number})`;
              return (
                <option key={label} value={label}>
                  {label}
                </option>
              );
            })}
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
          <input type="text" value={partNumber} onChange={(e) => setPartNumber(e.target.value)} />
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
          <input type="number" min={0} value={uio} onChange={(e) => setUio(Number(e.target.value) || 0)} />
        </div>
        <div className="calc-field">
          <label>Diskon (%)</label>
          <input
            type="number"
            min={0}
            max={100}
            value={discountPct}
            onChange={(e) => setDiscountPct(Number(e.target.value) || 0)}
          />
        </div>
      </div>
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
          <div className="fs-label">Contract price</div>
          <div className="fs-value">{fmtIDRFull(contractPrice)}</div>
        </div>
        <div className="formula-op">=</div>
        <div className="formula-result">
          <div className="fs-label">Amount market size</div>
          <div className="fs-value">{fmtIDRFull(amountMarketSize)}</div>
        </div>
      </div>
      <div className="btn-row" style={{ alignItems: "center" }}>
        <button className="btn btn-primary" onClick={handleAddToSummary} disabled={!partName}>
          + Tambah part ini ke summary
        </button>
        {justAdded && <span className="added-flash">✓ Ditambahkan ke summary di bawah</span>}
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
        <h2>Summary part yang dicek {items.length > 0 && <span className="count-badge">{items.length}</span>}</h2>
      </div>

      {items.length === 0 ? (
        <div className="empty-hint" style={{ margin: 0 }}>
          Belum ada part yang ditambahkan. Gunakan tombol <b>“+ Tambah part ini ke summary”</b> di kalkulator cepat di
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
                  <th>Part Name</th>
                  <th>Part Number</th>
                  <th>Customer</th>
                  <th>Qty/Unit</th>
                  <th>Pricelist</th>
                  <th>Freq (HM)</th>
                  <th>HM/Day</th>
                  <th>UIO</th>
                  <th>Diskon</th>
                  <th>Annual HM</th>
                  <th>Qty MS</th>
                  <th>Contract Price</th>
                  <th>Amount MS</th>
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
                    <td title={it.customer || ""}>{it.customer || "Semua"}</td>
                    <td>{fmtInt(it.qtyPerUnit)}</td>
                    <td>{fmtIDRFull(it.pricelist)}</td>
                    <td>{fmtInt(it.freqReplacementHm)}</td>
                    <td>{fmtInt(it.hmDay)}</td>
                    <td>{fmtInt(it.uio)}</td>
                    <td>{fmtPct(it.discount)}</td>
                    <td>{fmtInt(it.annualHm)}</td>
                    <td>{fmtInt(it.qtyMarketSize)}</td>
                    <td>{fmtIDRFull(it.contractPrice)}</td>
                    <td className="mono">{fmtIDRFull(it.amountMarketSize)}</td>
                    <td>
                      <button className="row-remove-btn" title="Hapus dari summary" onClick={() => removeItem(it.id)}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={14} style={{ textAlign: "right", fontWeight: 600 }}>
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
      <DetailTable state={state} />
    </>
  );
}
