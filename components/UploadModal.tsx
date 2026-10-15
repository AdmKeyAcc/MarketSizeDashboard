"use client";

import { useState } from "react";
import {
  downloadUioTemplate,
  downloadContractPriceTemplate,
  downloadNonContractPriceTemplate,
  downloadMasterPartTemplate,
  downloadActualSalesTemplate
} from "@/lib/downloadTemplates";
import { uploadMasterPart, uploadActualSales } from "@/lib/parse/uploadChunked";
import type { DataMeta } from "@/lib/types";

type SlotStatus = { text: string; ok: boolean } | null;
type Result = { ok: boolean; message: any };

/** Ringkasan isi database, untuk menampilkan "sudah ada / belum ada" di tiap jenis data. */
export type UploadCounts = {
  parts: number;
  uioUnits: number;
  contractPrices: number;
  nonContractPrices: number;
  actualSales: number;
};

async function uploadFile(url: string, file: File): Promise<Result> {
  const form = new FormData();
  form.append("file", file);
  try {
    const res = await fetch(url, { method: "POST", body: form });
    const json = await res.json();
    if (!res.ok) return { ok: false, message: json.error || "Gagal memproses file." };
    return { ok: true, message: json };
  } catch (err) {
    return { ok: false, message: (err as Error).message || "Gagal terhubung ke server." };
  }
}

const fmt = (n: number) => n.toLocaleString("id-ID");

function Slot({
  title,
  hint,
  count,
  countUnit,
  lastFile,
  status,
  busy,
  onPick,
  onTemplate,
  accept = ".xlsx,.xls"
}: {
  title: string;
  hint: React.ReactNode;
  count: number;
  countUnit: string;
  lastFile?: string | null;
  status: SlotStatus;
  busy: boolean;
  onPick: (file: File) => void;
  onTemplate: () => void;
  accept?: string;
}) {
  return (
    <div className="upload-slot">
      <h4>{title}</h4>
      <div className="hint">{hint}</div>
      <div className={"upload-state " + (count > 0 ? "has" : "empty")}>
        {count > 0
          ? `✓ Sudah ada ${fmt(count)} ${countUnit}${lastFile ? ` · upload terakhir: ${lastFile}` : ""}`
          : "● Belum ada data"}
      </div>
      <div className="upload-row">
        <input
          type="file"
          className="file-input"
          accept={accept}
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPick(f);
            e.target.value = "";
          }}
        />
        <button className="link-btn" onClick={onTemplate}>
          Unduh template
        </button>
      </div>
      {status && <div className={"upload-status " + (status.ok ? "ok" : "err")}>{status.text}</div>}
    </div>
  );
}

export default function UploadModal({
  open,
  onClose,
  onUploaded,
  counts,
  meta
}: {
  open: boolean;
  onClose: () => void;
  onUploaded: () => Promise<void> | void;
  counts: UploadCounts;
  meta: DataMeta;
}) {
  const [stUio, setStUio] = useState<SlotStatus>(null);
  const [stSales, setStSales] = useState<SlotStatus>(null);
  const [stPart, setStPart] = useState<SlotStatus>(null);
  const [stContract, setStContract] = useState<SlotStatus>(null);
  const [stNonContract, setStNonContract] = useState<SlotStatus>(null);
  const [masterOpen, setMasterOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function run(setStatus: (s: SlotStatus) => void, task: () => Promise<Result>, success: (j: any) => string) {
    setBusy(true);
    setStatus({ text: "Memproses…", ok: true });
    const result = await task();
    if (result.ok) {
      setStatus({ text: success(result.message), ok: true });
      await onUploaded();
    } else {
      setStatus({ text: "Gagal: " + result.message, ok: false });
    }
    setBusy(false);
  }

  const skippedText = (j: any) => (j.skipped ? ` (${j.skipped} baris dilewati.)` : "");
  const dupText = (j: any) => (j.duplicates ? ` (${j.duplicates} baris kembar digabung.)` : "");

  // Data master yang wajib ada supaya market size bisa dihitung.
  const missingMaster = [
    counts.parts === 0 ? "Master Part" : null,
    counts.contractPrices + counts.nonContractPrices === 0 ? "Data Harga" : null
  ].filter(Boolean) as string[];

  return (
    <div className="modal-scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <button className="modal-close" onClick={onClose}>
          ✕
        </button>
        <h3>Upload data</h3>
        
        {missingMaster.length > 0 && (
          <div className="upload-warn">
            ⚠ <b>{missingMaster.join(" dan ")}</b> belum ada, jadi market size belum bisa dihitung. Buka bagian{" "}
            <b>Data master</b> di bawah dan upload dulu.
          </div>
        )}

        <div className="upload-group-title">Data rutin</div>

        <Slot
          title="1. Data Actual Sales"
          hint={
            <>
              Kolom: Tahun, Bulan, Customer Group, Customer Name, Product, Model Unit,
              Part Number, Part Name, Qty, Amount (Rp).
            </>
          }
          count={counts.actualSales}
          countUnit="baris transaksi"
          lastFile={meta.actual_sales_filename}
          status={stSales}
          busy={busy}
          onPick={(f) =>
            run(setStSales, () => uploadActualSales(f, (t) => setStSales({ text: t, ok: true })), (j) =>
              `Berhasil: ${fmt(j.rowCount)} baris untuk ${j.periods} periode (bulan/tahun) disimpan.${skippedText(j)}`
            )
          }
          onTemplate={downloadActualSalesTemplate}
          accept=".xlsx,.xls,.csv"
        />

        <Slot
          title="2. Data UIO"
          hint={
            <>
              Kolom : Branch, Pss Name, Cust. Code, Cust. Name, Cust. Group, Cust. Type, Product, Model, Serial Number, Year,
              HM/Day, Day/Month, Month/Year.
            </>
          }
          count={counts.uioUnits}
          countUnit="unit"
          lastFile={meta.uio_units_filename}
          status={stUio}
          busy={busy}
          onPick={(f) =>
            run(setStUio, () => uploadFile("/api/upload/uio-units", f), (j) =>
              `Berhasil: ${fmt(j.rowCount)} baris unit terbaca (sheet "${j.sheet}").${skippedText(j)}`
            )
          }
          onTemplate={downloadUioTemplate}
        />

        <button type="button" className="upload-group-toggle" onClick={() => setMasterOpen((v) => !v)}>
          <span>{masterOpen ? "▾" : "▸"}</span> Data master — upload hanya jika ada perubahan
          {!masterOpen && missingMaster.length > 0 && <span className="upload-group-badge">perlu diisi</span>}
        </button>

        {masterOpen && (
          <>
            <Slot
              title="3. Master Part — daftar part per model"
              hint={
                <>
                  Kolom: Product, Model Unit, Part Number, Part Name, Qty per Unit, Frekuensi Ganti (HM), HM per Hari.
                </>
              }
              count={counts.parts}
              countUnit="part"
              lastFile={meta.kalkulator_filename}
              status={stPart}
              busy={busy}
              onPick={(f) =>
                run(setStPart, () => uploadMasterPart(f, (t) => setStPart({ text: t, ok: true })), (j) =>
                  `Berhasil: ${fmt(j.rowCount)} part disimpan.${dupText(j)}${skippedText(j)}`
                )
              }
              onTemplate={downloadMasterPartTemplate}
          accept=".xlsx,.xls,.csv"
            />

            <Slot
              title="4. Data Harga Kontrak — SCPL"
              hint={
                <>
                  Kolom: Cust. Code, Cust. Name, Cust. Group, Cust. Type, Part Number, Harga.
              }
              count={counts.contractPrices}
              countUnit="harga kontrak"
              lastFile={meta.price_list_filename}
              status={stContract}
              busy={busy}
              onPick={(f) =>
                run(setStContract, () => uploadFile("/api/upload/price-contract", f), (j) =>
                  `Berhasil: ${fmt(j.rowCount)} harga kontrak disimpan.${dupText(j)}${skippedText(j)}`
                )
              }
              onTemplate={downloadContractPriceTemplate}
            />

            <Slot
              title="5. Data Harga Non Kontrak"
              hint={
                <>
                  Kolom : Cust. Code, Cust. Name, Cust. Group, Cust. Type, Part Number, Harga.
                </>
              }
              count={counts.nonContractPrices}
              countUnit="harga non kontrak"
              lastFile={meta.price_list_filename}
              status={stNonContract}
              busy={busy}
              onPick={(f) =>
                run(setStNonContract, () => uploadFile("/api/upload/price-non-contract", f), (j) =>
                  `Berhasil: ${fmt(j.rowCount)} harga non kontrak disimpan (- 50%).${dupText(j)}${skippedText(j)}`
                )
              }
              onTemplate={downloadNonContractPriceTemplate}
            />
          </>
        )}
      </div>
    </div>
  );
}
