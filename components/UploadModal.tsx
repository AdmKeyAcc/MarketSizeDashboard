"use client";

import { useState } from "react";
import {
  downloadUioTemplate,
  downloadContractPriceTemplate,
  downloadNonContractPriceTemplate,
  downloadMasterPartTemplate
} from "@/lib/downloadTemplates";
import { uploadMasterPart, uploadActualSalesYear, uploadUioUnits } from "@/lib/parse/uploadChunked";
import { syncActualSales } from "@/lib/syncActual";
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
  extra,
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
  onTemplate?: () => void;
  extra?: React.ReactNode;
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
      {extra}
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
        {onTemplate && (
          <button className="link-btn" onClick={onTemplate}>
            Unduh template
          </button>
        )}
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
  const [stSync, setStSync] = useState<SlotStatus>(null);
  const [masterOpen, setMasterOpen] = useState(false);
  // Data tahun terbaru di laporan Actual Sales biasanya belum setahun penuh (YTD).
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

        <div className="upload-slot">
          <h4>Actual Sales — otomatis dari web Sales</h4>
          <div className="hint">
            Diambil langsung dari data penjualan di web Sales (sumber SAP yang sama dengan Laporan Sales), di luar cabang
            yang dikecualikan (tabel <code>actual_branch_exclusions</code>). Berjalan otomatis tiap jam; tombol di bawah untuk
            sinkron saat ini juga. Isi ulang per tahun, jadi aman diulang.
          </div>
          <div className={"upload-state " + (meta.actual_year_synced_at ? "has" : "empty")}>
            {meta.actual_year_synced_at
              ? `✓ Sinkron terakhir ${new Date(meta.actual_year_synced_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}` +
                `${meta.actual_year_max_date ? ` · data sampai ${new Date(meta.actual_year_max_date).toLocaleDateString("id-ID", { dateStyle: "medium" })}` : ""}` +
                `${meta.actual_tx_count ? ` · ${fmt(meta.actual_tx_count)} baris per part/bulan` : ""}`
              : "● Belum pernah sinkron — Actual Sales masih dari upload file"}
          </div>
          <div className="upload-row">
            <button
              type="button"
              className="link-btn"
              disabled={busy}
              onClick={() => run(setStSync, () => syncActualSales("recent", (t) => setStSync({ text: t, ok: true })), (m) => `Berhasil. ${m}`)}
            >
              ⟳ Sinkron sekarang (tahun berjalan)
            </button>
            <button
              type="button"
              className="link-btn"
              disabled={busy}
              onClick={() => run(setStSync, () => syncActualSales("all", (t) => setStSync({ text: t, ok: true })), (m) => `Berhasil. ${m}`)}
            >
              Sinkron ulang semua tahun (beberapa menit)
            </button>
          </div>
          {stSync && <div className={"upload-status " + (stSync.ok ? "ok" : "err")}>{stSync.text}</div>}
        </div>

        <Slot
          title="1. Actual Sales — upload Laporan Sales manual (cadangan)"
          hint={
            <>
              Laporan 3 tingkat <b>Product → Customer Group → Customer</b> (disarankan, supaya Actual bisa difilter per Product),
              atau <b>KA Type → Customer Group → Customer</b>, atau 2 tingkat <b>Customer Group → Customer</b>, dengan satu
              kolom nilai (Rp) per tahun (2018, 2019, dst) dan baris <b>GRAND TOTAL</b>. Tingkat dibaca dari grouping (outline) baris Excel, jadi pakai file laporan
              apa adanya. Upload ini hanya <b>mengganti tahun-tahun yang ada di file</b>; data tahun lain yang sudah tersimpan tidak terhapus.
              Pakai hanya kalau sinkron otomatis bermasalah — sinkron berikutnya akan menimpa tahun yang sama.
            </>
          }
          count={counts.actualSales}
          countUnit="baris (customer × tahun)"
          lastFile={meta.actual_year_filename}
          status={stSales}
          busy={busy}
          onPick={(f) =>
            run(setStSales, () => uploadActualSalesYear(f, (t) => setStSales({ text: t, ok: true })), (j) =>
              `Berhasil: ${fmt(j.rowCount)} baris (${fmt(j.customers)} customer, ${fmt(j.groups)} grup${j.kind === "product" ? `, ${fmt(j.products)} product` : ""}, tahun ${Math.min(...j.years)}–${j.latestYear}). Data ${j.latestYear} dianggap sampai ${j.ytdMonth} (dibaca otomatis dari tanggal di nama file / tanggal upload).${
                j.totalDiff > 0 ? ` ⚠ Jumlah customer berbeda Rp ${fmt(j.totalDiff)} dari GRAND TOTAL.` : ""
              }`
            )
          }
          accept=".xlsx,.xls"
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
            run(setStUio, () => uploadUioUnits(f, (t) => setStUio({ text: t, ok: true })), (j) =>
              `Berhasil: ${fmt(j.rowCount)} unit disimpan (sheet "${j.sheet}"). Nama customer: ${fmt(j.exact)} sudah cocok, ${fmt(j.remapped)} disamakan dengan Master Customer, ${fmt(j.unmatched)} tidak ditemukan di master.${
                j.returns ? ` ${fmt(j.returns)} baris retur dibuang.` : ""
              }${j.beforeMinYear ? ` ${fmt(j.beforeMinYear)} unit sebelum ${j.minYear} dilewati.` : ""}${skippedText(j)} Upload ini mengganti seluruh Data UIO sebelumnya.`
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
                </>
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
                  `Berhasil: ${fmt(j.rowCount)} harga non kontrak disimpan (- ${Math.round((typeof j.discount === "number" ? j.discount : 0.5) * 100)}%).${dupText(j)}${skippedText(j)}`
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
