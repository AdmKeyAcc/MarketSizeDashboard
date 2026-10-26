"use client";

import { useState } from "react";
import {
  downloadUioTemplate,
  downloadContractPriceTemplate,
  downloadNonContractPriceTemplate,
  downloadMasterPartTemplate
} from "@/lib/downloadTemplates";
import { uploadMasterPart, uploadUioUnits } from "@/lib/parse/uploadChunked";
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

type ClearTarget = "uio_units" | "price_contract" | "price_non_contract" | "parts";

async function clearData(target: ClearTarget, pin: string): Promise<Result> {
  try {
    const res = await fetch("/api/data/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, pin })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: json.error || "Gagal menghapus data." };
    return { ok: true, message: json };
  } catch (err) {
    return { ok: false, message: (err as Error).message || "Gagal terhubung ke server." };
  }
}

/** Tombol "Hapus data" dengan konfirmasi + PIN admin, ditampilkan di bawah slot yang sudah berisi data. */
function ClearControl({ count, countUnit, busy, onClear }: { count: number; countUnit: string; busy: boolean; onClear: (pin: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  if (count === 0) return null;
  if (!open) {
    return (
      <button type="button" className="link-btn danger" disabled={busy} onClick={() => setOpen(true)}>
        Hapus data
      </button>
    );
  }
  return (
    <div className="clear-confirm">
      <div>
        Hapus <b>semua {fmt(count)} {countUnit}</b>? Tidak bisa dibatalkan — untuk mengembalikan, upload ulang filenya.
      </div>
      <div className="upload-row">
        <input
          type="password"
          className="pin-input"
          placeholder="PIN admin"
          value={pin}
          autoFocus
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && pin) {
              onClear(pin);
              setOpen(false);
              setPin("");
            }
          }}
        />
        <button
          type="button"
          className="danger-btn"
          disabled={busy || !pin}
          onClick={() => {
            onClear(pin);
            setOpen(false);
            setPin("");
          }}
        >
          Ya, hapus
        </button>
        <button type="button" className="link-btn" onClick={() => { setOpen(false); setPin(""); }}>
          Batal
        </button>
      </div>
    </div>
  );
}

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
  onClear,
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
  /** Kalau diisi, muncul tombol "Hapus data" (dengan konfirmasi + PIN). */
  onClear?: (pin: string) => void;
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
        {onClear && <ClearControl count={count} countUnit={countUnit} busy={busy} onClear={onClear} />}
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
  const [stPart, setStPart] = useState<SlotStatus>(null);
  const [stContract, setStContract] = useState<SlotStatus>(null);
  const [stNonContract, setStNonContract] = useState<SlotStatus>(null);
  const [stSync, setStSync] = useState<SlotStatus>(null);
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

  // Data yang wajib ada supaya market size bisa dihitung.
  const missing = [
    counts.uioUnits === 0 ? "Data UIO" : null,
    counts.contractPrices + counts.nonContractPrices === 0 ? "Data Harga" : null,
    counts.parts === 0 ? "Master Part" : null
  ].filter(Boolean) as string[];

  const syncedAt = meta.actual_year_synced_at ? new Date(meta.actual_year_synced_at) : null;
  const dataUntil = meta.actual_year_max_date ? new Date(meta.actual_year_max_date) : null;

  return (
    <div className="modal-scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <button className="modal-close" onClick={onClose}>
          ✕
        </button>
        <h3>Upload data</h3>

        {missing.length > 0 && (
          <div className="upload-warn">
            ⚠ <b>{missing.join(", ")}</b> belum ada, jadi market size belum bisa dihitung.
            {counts.parts === 0 && (
              <>
                {" "}Master Part ada di bagian <b>Data master</b> di bawah.
              </>
            )}
          </div>
        )}

        <div className="upload-group-title">Data utama</div>

        <Slot
          title="1. Data UIO"
          hint={
            <>
              Kolom: Branch, Pss Name, Cust. Code, Cust. Name, Cust. Group, Cust. Type, Product, Model, Serial Number, Year,
              HM/Day, Day/Month, Month/Year. Upload ini mengganti seluruh Data UIO sebelumnya.
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
          onClear={(pin) => run(setStUio, () => clearData("uio_units", pin), (j) => `Terhapus: ${fmt(j.deleted)} baris ${j.label}.`)}
        />

        <Slot
          title="2. Data Harga Kontrak (SCPL)"
          hint={<>Kolom: Cust. Code, Cust. Name, Cust. Group, Cust. Type, Part Number, Harga.</>}
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
          onClear={(pin) => run(setStContract, () => clearData("price_contract", pin), (j) => `Terhapus: ${fmt(j.deleted)} baris ${j.label}.`)}
        />

        <Slot
          title="3. Data Harga Non Kontrak"
          hint={<>Kolom: Cust. Code, Cust. Name, Cust. Group, Cust. Type, Part Number, Harga.</>}
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
          onClear={(pin) => run(setStNonContract, () => clearData("price_non_contract", pin), (j) => `Terhapus: ${fmt(j.deleted)} baris ${j.label}.`)}
        />

        <button type="button" className="upload-group-toggle" onClick={() => setMasterOpen((v) => !v)}>
          <span>{masterOpen ? "▾" : "▸"}</span> Data master — upload hanya jika ada perubahan
          {!masterOpen && counts.parts === 0 && <span className="upload-group-badge">perlu diisi</span>}
        </button>

        {masterOpen && (
          <Slot
            title="Master Part — daftar part per model"
            hint={
              <>
                Kolom: Product, Model Unit, Part Number, Part Name, Qty per Unit, Frekuensi Ganti (HM), HM per Hari. Part yang sama
                diperbarui, part baru ditambahkan, part lain tidak dihapus.
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
          onClear={(pin) => run(setStPart, () => clearData("parts", pin), (j) => `Terhapus: ${fmt(j.deleted)} baris ${j.label}.`)}
            accept=".xlsx,.xls,.csv"
          />
        )}

        <div className="upload-group-title">Otomatis — tidak perlu upload</div>

        <div className="upload-slot">
          <h4>Actual Sales — tersinkron dari web Sales</h4>
          <div className="hint">
            Diambil otomatis tiap jam dari data penjualan di web Sales. Admin cukup menginput di web Sales.
          </div>
          <div className={"upload-state " + (syncedAt ? "has" : "empty")}>
            {syncedAt
              ? `✓ Sinkron terakhir ${syncedAt.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}` +
                `${dataUntil ? ` · data sampai ${dataUntil.toLocaleDateString("id-ID", { dateStyle: "medium" })}` : ""}`
              : "● Belum pernah sinkron"}
          </div>
          <div className="upload-row">
            <button
              type="button"
              className="link-btn"
              disabled={busy}
              onClick={() => run(setStSync, () => syncActualSales("recent", (t) => setStSync({ text: t, ok: true })), (m) => `Berhasil. ${m}`)}
            >
              ⟳ Sinkron sekarang
            </button>
            <button
              type="button"
              className="link-btn"
              disabled={busy}
              title="Mengisi ulang semua tahun sejak 2018 (beberapa menit). Perlu hanya jika data lama di web Sales dikoreksi."
              onClick={() => run(setStSync, () => syncActualSales("all", (t) => setStSync({ text: t, ok: true })), (m) => `Berhasil. ${m}`)}
            >
              Sinkron ulang semua tahun
            </button>
          </div>
          {stSync && <div className={"upload-status " + (stSync.ok ? "ok" : "err")}>{stSync.text}</div>}
        </div>
      </div>
    </div>
  );
}
