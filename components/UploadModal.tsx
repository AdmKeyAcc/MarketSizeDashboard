"use client";

import { useState } from "react";
import {
  downloadUioTemplate,
  downloadContractPriceTemplate,
  downloadNonContractPriceTemplate,
  downloadMasterPartTemplate
} from "@/lib/downloadTemplates";
import { uploadMasterPart, prepareUioUpload, type UioPrepared, type UioUploadMode } from "@/lib/parse/uploadChunked";
import { downloadCurrentData, type DownloadKind } from "@/lib/downloadCurrent";
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
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
};

async function verifyPin(pin: string): Promise<string | null> {
  try {
    const res = await fetch("/api/admin/verify-pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
    if (res.ok) return null;
    const j = await res.json().catch(() => ({}));
    return j.error || "PIN tidak bisa dicek.";
  } catch (err) {
    return (err as Error).message || "Gagal terhubung ke server.";
  }
}

/** Tombol "Download data saat ini" — isi database terbaru, format sama dengan template upload. */
function DownloadButton({ kind, busy, label = "⬇ Download data saat ini", title }: { kind: DownloadKind; busy: boolean; label?: string; title?: string }) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  return (
    <button
      type="button"
      className="link-btn"
      disabled={busy || state === "loading"}
      title={title ?? "Unduh isi database saat ini dalam format template — bisa diedit lalu di-upload lagi."}
      onClick={async () => {
        setState("loading");
        try {
          await downloadCurrentData(kind);
          setState("idle");
        } catch (err) {
          console.error(err);
          setState("error");
        }
      }}
    >
      {state === "loading" ? "Menyiapkan file…" : state === "error" ? "Gagal mengunduh — coba lagi" : label}
    </button>
  );
}

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

/** Hasil pemeriksaan file Data UIO sebelum disimpan: kolom yang tidak ada, isi kosong / tidak valid. */
function UioCheck({ prep, busy, onContinue, onCancel }: { prep: UioPrepared; busy: boolean; onContinue: () => void; onCancel: () => void }) {
  const v = prep.validation;
  const mg = prep.merge;
  const penting = v.issues.filter((i) => i.level === "penting");
  const info = v.issues.filter((i) => i.level === "info");
  const rowsText = (rows: number[], count: number) =>
    `baris ${rows.join(", ")}${count > rows.length ? `, … (+${fmt(count - rows.length)} lainnya)` : ""}`;
  return (
    <div className={"uio-check " + (v.missingColumns.length > 0 || penting.length > 0 ? "warn" : "info")}>
      <div className="uio-check-title">
        Pemeriksaan file: {fmt(prep.rowCount)} unit siap disimpan (sheet "{prep.sheet}"). <b>Data belum disimpan.</b>
      </div>
      {mg ? (
        <div className="uio-check-row">
          ⟳ <b>Mode tambah / perbarui</b> (dicocokkan dengan Serial Number): <b>{fmt(mg.updated)}</b> unit diperbarui,{" "}
          <b>{fmt(mg.added)}</b> unit baru ditambahkan. Unit lain di database ({fmt(Math.max(mg.existing - mg.updated, 0))}) tidak diubah.
          {mg.noSerial > 0 && (
            <>
              {" "}⚠ <b>{fmt(mg.noSerial)} baris tanpa Serial Number</b> tidak disimpan (tidak bisa dicocokkan — gunakan mode Ganti semua bila perlu).
            </>
          )}
        </div>
      ) : (
        <div className="uio-check-row muted">⟲ Mode ganti semua: seluruh Data UIO di database diganti isi file ini.</div>
      )}
      {v.missingColumns.length > 0 && (
        <div className="uio-check-row">
          ⚠ <b>Kolom tidak ditemukan:</b> {v.missingColumns.join(", ")}. Cek judul kolom sesuai template (mis. "Year Inv", "Month Inv").
        </div>
      )}
      {penting.map((i) => (
        <div className="uio-check-row" key={i.message}>
          ⚠ <b>{fmt(i.count)} baris</b> — {i.message} <span className="uio-check-rows">({rowsText(i.rows, i.count)})</span>
        </div>
      ))}
      {info.map((i) => (
        <div className="uio-check-row muted" key={i.message}>
          ℹ {fmt(i.count)} baris — {i.message} <span className="uio-check-rows">({rowsText(i.rows, i.count)})</span>
        </div>
      ))}
      <div className="upload-row">
        <button type="button" className="danger-btn" disabled={busy} onClick={onContinue}>
          {v.missingColumns.length > 0 || v.issues.some((i) => i.level === "penting") ? "Tetap upload" : "Simpan"}
        </button>
        <button type="button" className="link-btn" disabled={busy} onClick={onCancel}>
          Batal, perbaiki file dulu
        </button>
      </div>
    </div>
  );
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
  updatedAt,
  download,
  status,
  busy,
  onPick,
  onTemplate,
  onClear,
  extra,
  accept = ".xlsx,.xls"
}: {
  title: string;
  hint?: React.ReactNode;
  count: number;
  countUnit: string;
  lastFile?: string | null;
  /** Waktu upload terakhir (ISO). */
  updatedAt?: string | null;
  /** Kalau diisi, muncul tombol "Download data saat ini". */
  download?: DownloadKind;
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
      {hint && <div className="hint">{hint}</div>}
      <div className={"upload-state " + (count > 0 ? "has" : "empty")}>
        {count > 0
          ? `✓ Sudah ada ${fmt(count)} ${countUnit}${lastFile ? ` · upload terakhir: ${lastFile}` : ""}${fmtDate(updatedAt) ? ` (${fmtDate(updatedAt)})` : ""}`
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
        {download && count > 0 && <DownloadButton kind={download} busy={busy} />}
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
  const [uioPending, setUioPending] = useState<UioPrepared | null>(null);
  const [stPart, setStPart] = useState<SlotStatus>(null);
  const [stContract, setStContract] = useState<SlotStatus>(null);
  const [stNonContract, setStNonContract] = useState<SlotStatus>(null);
  const [stSync, setStSync] = useState<SlotStatus>(null);
  const [masterOpen, setMasterOpen] = useState(false);
  const [uioMode, setUioMode] = useState<UioUploadMode>("replace");
  const [advOpen, setAdvOpen] = useState(false);
  const [syncPin, setSyncPin] = useState("");
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

  const uioDoneText = (j: any) =>
    `Berhasil: ${fmt(j.rowCount)} unit disimpan (sheet "${j.sheet}"). Nama customer: ${fmt(j.exact)} sudah cocok, ${fmt(j.remapped)} disamakan dengan Master Customer, ${fmt(j.unmatched)} tidak ditemukan di master.${
      j.returns ? ` ${fmt(j.returns)} baris retur dibuang.` : ""
    }${j.beforeMinYear ? ` ${fmt(j.beforeMinYear)} unit sebelum ${j.minYear} dilewati.` : ""}${skippedText(j)} ${
      j.mode === "merge"
        ? `Mode tambah / perbarui: ${fmt(j.merge?.updated ?? 0)} unit diperbarui, ${fmt(j.merge?.added ?? 0)} unit baru${
            j.merge?.noSerial ? `, ${fmt(j.merge.noSerial)} baris tanpa Serial Number tidak disimpan` : ""
          }.${typeof j.totalInDb === "number" ? ` Total Data UIO sekarang ${fmt(j.totalInDb)} unit.` : ""}`
        : "Upload ini mengganti seluruh Data UIO sebelumnya."
    }`;

  /** Data UIO: periksa file dulu. Kalau ada masalah, tampilkan ringkasan dan tunggu keputusan pengguna. */
  async function pickUio(f: File) {
    setUioPending(null);
    setBusy(true);
    setStUio({ text: "Memeriksa file (bisa beberapa puluh detik)…", ok: true });
    const r = await prepareUioUpload(f, uioMode);
    setBusy(false);
    if (!r.ok) {
      setStUio({ text: "Gagal: " + r.message, ok: false });
      return;
    }
    const v = r.prep.validation;
    // Mode tambah/perbarui selalu minta konfirmasi (ringkasan unit diperbarui / baru).
    if (v.missingColumns.length > 0 || v.issues.length > 0 || r.prep.mode === "merge") {
      setStUio(null);
      setUioPending(r.prep);
      return;
    }
    await run(setStUio, () => r.prep.commit((t) => setStUio({ text: t, ok: true })), uioDoneText);
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
          count={counts.uioUnits}
          countUnit="unit"
          lastFile={meta.uio_units_filename ? `${meta.uio_units_filename}${meta.uio_units_mode === "merge" ? " (tambah/perbarui)" : ""}` : null}
          updatedAt={meta.uio_units_updated_at}
          download="uio"
          status={stUio}
          busy={busy}
          onPick={pickUio}
          extra={
            <>
            <div className="upload-mode" role="radiogroup" aria-label="Cara upload Data UIO">
              <label className={uioMode === "replace" ? "on" : ""}>
                <input type="radio" name="uio-mode" checked={uioMode === "replace"} disabled={busy} onChange={() => setUioMode("replace")} />
                <span><b>Ganti semua</b> — file berisi seluruh populasi unit. Unit yang tidak ada di file ikut terhapus.</span>
              </label>
              <label className={uioMode === "merge" ? "on" : ""}>
                <input type="radio" name="uio-mode" checked={uioMode === "merge"} disabled={busy} onChange={() => setUioMode("merge")} />
                <span><b>Tambah / perbarui</b> — dicocokkan dengan Serial Number. Unit lain tidak diubah (untuk tambahan unit baru).</span>
              </label>
            </div>
            {uioPending && (
              <UioCheck
                prep={uioPending}
                busy={busy}
                onContinue={() => {
                  const prep = uioPending;
                  setUioPending(null);
                  run(setStUio, () => prep.commit((t) => setStUio({ text: t, ok: true })), uioDoneText);
                }}
                onCancel={() => {
                  setUioPending(null);
                  setStUio({ text: "Upload dibatalkan — tidak ada data yang diubah.", ok: false });
                }}
              />
            )}
            </>
          }
          onTemplate={downloadUioTemplate}
          onClear={(pin) => run(setStUio, () => clearData("uio_units", pin), (j) => `Terhapus: ${fmt(j.deleted)} baris ${j.label}.`)}
        />

        <Slot
          title="2. Data Harga Kontrak (SCPL)"
          count={counts.contractPrices}
          countUnit="harga kontrak"
          lastFile={meta.price_contract_filename ?? meta.price_list_filename}
          updatedAt={meta.price_contract_filename ? meta.price_contract_updated_at : null}
          download="contract"
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
          count={counts.nonContractPrices}
          countUnit="harga non kontrak"
          lastFile={meta.price_non_contract_filename ?? meta.price_list_filename}
          updatedAt={meta.price_non_contract_filename ? meta.price_non_contract_updated_at : null}
          download="non_contract"
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
            count={counts.parts}
            countUnit="part"
            lastFile={meta.kalkulator_filename}
            updatedAt={meta.kalkulator_updated_at}
            download="parts"
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
            Diambil otomatis tiap jam dari data penjualan di web Sales — admin cukup menginput di web Sales, tidak perlu menekan tombol apa pun.
          </div>
          <div className={"upload-state " + (syncedAt ? "has" : "empty")}>
            {syncedAt
              ? `✓ Tersinkron otomatis · terakhir ${syncedAt.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}` +
                `${dataUntil ? ` · data sampai ${dataUntil.toLocaleDateString("id-ID", { dateStyle: "medium" })}` : ""}`
              : "● Belum pernah sinkron"}
          </div>
          <div className="upload-row">
            <button
              type="button"
              className="link-btn small"
              disabled={busy}
              title="Tidak wajib — sinkron otomatis jalan tiap jam. Pakai kalau baru input di web Sales dan ingin langsung terlihat."
              onClick={() => run(setStSync, () => syncActualSales("recent", (t) => setStSync({ text: t, ok: true })), (m) => `Berhasil. ${m}`)}
            >
              ⟳ Sinkron sekarang
            </button>
            {counts.actualSales > 0 && (
              <DownloadButton kind="actual" busy={busy} title="Unduh Actual per tahun × customer × product (dengan rincian bulan) untuk dicocokkan dengan web Sales." />
            )}
            <button type="button" className="link-btn small muted-btn" onClick={() => setAdvOpen((v) => !v)}>
              {advOpen ? "▾" : "▸"} Lanjutan
            </button>
          </div>
          {advOpen && (
            <div className="sync-advanced">
              <div>
                <b>Sinkron ulang semua tahun</b> — mengisi ulang Actual sejak 2018 (beberapa menit). Perlu hanya setelah update
                rumus/aturan (mis. cabang yang dikecualikan diubah) atau data lama di web Sales dikoreksi.
              </div>
              <div className="upload-row">
                <input
                  type="password"
                  className="pin-input"
                  placeholder="PIN admin"
                  value={syncPin}
                  disabled={busy}
                  onChange={(e) => setSyncPin(e.target.value)}
                />
                <button
                  type="button"
                  className="danger-btn"
                  disabled={busy || !syncPin}
                  onClick={() =>
                    run(
                      setStSync,
                      async () => {
                        setStSync({ text: "Memeriksa PIN…", ok: true });
                        const err = await verifyPin(syncPin);
                        if (err) return { ok: false, message: err };
                        setSyncPin("");
                        return syncActualSales("all", (t) => setStSync({ text: t, ok: true }));
                      },
                      (m) => `Berhasil. ${m}`
                    )
                  }
                >
                  Sinkron ulang semua tahun
                </button>
              </div>
            </div>
          )}
          {stSync && <div className={"upload-status " + (stSync.ok ? "ok" : "err")}>{stSync.text}</div>}
        </div>
      </div>
    </div>
  );
}