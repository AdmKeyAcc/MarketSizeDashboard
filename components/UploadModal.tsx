"use client";

import { createContext, useContext, useRef, useState } from "react";
import { EMPTY_LISTS, type TemplateLists } from "@/lib/downloadTemplates";

/** Daftar pilihan dropdown template (dari data website). */
const ListsCtx = createContext<TemplateLists>(EMPTY_LISTS);
import {
  downloadUioTemplate,
  downloadContractPriceTemplate,
  downloadNonContractPriceTemplate,
  downloadMasterPartTemplate
} from "@/lib/downloadTemplates";
import { uploadMasterPart, prepareUioUpload, type UioPrepared, type UioUploadMode } from "@/lib/parse/uploadChunked";
import { downloadCurrentData, type DownloadKind } from "@/lib/downloadCurrent";
import { checkUploadFile, type CheckKind, type FileCheck } from "@/lib/parse/fileCheck";
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

type Mode = "merge" | "replace";

async function uploadFile(url: string, file: File, mode: Mode): Promise<Result> {
  const form = new FormData();
  form.append("file", file);
  form.append("mode", mode);
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

/** Tombol "Download data saat ini" — isi database terbaru, format sama dengan template upload. */
function DownloadButton({ kind, busy, label = "⬇ Download data saat ini", title }: { kind: DownloadKind; busy: boolean; label?: string; title?: string }) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const lists = useContext(ListsCtx);
  return (
    <button
      type="button"
      className="slot-btn"
      disabled={busy || state === "loading"}
      title={title ?? "Unduh isi database saat ini dalam format template — bisa diedit lalu di-upload lagi."}
      onClick={async () => {
        setState("loading");
        try {
          await downloadCurrentData(kind, lists);
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

/** Panel hasil pemeriksaan file — tampil SETELAH file dipilih dan SEBELUM data disimpan.
 * Pilihan: "Lanjutkan upload" atau "Perbaiki file" (tidak ada data yang diubah). */
function CheckPanel({
  title,
  modeText,
  validation: v,
  extra,
  busy,
  onContinue,
  onCancel
}: {
  title: React.ReactNode;
  modeText: React.ReactNode;
  validation: { missingColumns: string[]; issues: { level: "penting" | "info"; message: string; count: number; rows: number[] }[] };
  extra?: React.ReactNode;
  busy: boolean;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const penting = v.issues.filter((i) => i.level === "penting");
  const info = v.issues.filter((i) => i.level === "info");
  const rowsText = (rows: number[], count: number) =>
    `baris ${rows.join(", ")}${count > rows.length ? `, … (+${fmt(count - rows.length)} lainnya)` : ""}`;
  const problem = v.missingColumns.length > 0 || penting.length > 0;
  return (
    <div className={"uio-check " + (problem ? "warn" : "info")}>
      <div className="uio-check-title">
        {title} <b>Data belum disimpan.</b>
      </div>
      {extra}
      <div className="uio-check-row">{modeText}</div>
      {v.missingColumns.length > 0 && (
        <div className="uio-check-row">
          ⚠ <b>Kolom tidak ditemukan:</b> {v.missingColumns.join(", ")}. Cek judul kolom sesuai template.
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
      {!problem && info.length === 0 && <div className="uio-check-row muted">Tidak ada baris dobel atau bermasalah.</div>}
      <div className="upload-row">
        <button type="button" className={problem ? "danger-btn" : "primary-btn"} disabled={busy} onClick={onContinue}>
          Lanjutkan upload
        </button>
        <button type="button" className="link-btn" disabled={busy} onClick={onCancel}>
          Perbaiki file
        </button>
      </div>
    </div>
  );
}

/** Pemeriksaan Data UIO (ada pilihan sheet dan perbandingan Serial Number). */
function UioCheck({
  prep,
  busy,
  onContinue,
  onCancel,
  onSheet
}: {
  prep: UioPrepared;
  busy: boolean;
  onContinue: () => void;
  onCancel: () => void;
  onSheet: (sheet: string) => void;
}) {
  const mg = prep.merge;
  return (
    <CheckPanel
      title={<>Pemeriksaan file: {fmt(prep.rowCount)} unit siap disimpan (sheet &quot;{prep.sheet}&quot;).</>}
      validation={prep.validation}
      busy={busy}
      onContinue={onContinue}
      onCancel={onCancel}
      extra={
        prep.sheets.length > 1 ? (
          <div className="uio-check-row">
            📄 File ini punya {prep.sheets.length} sheet berisi data unit. Sheet yang dipakai:{" "}
            <select value={prep.sheet} disabled={busy} onChange={(e) => onSheet(e.target.value)}>
              {prep.sheets.map((sh) => (
                <option key={sh.name} value={sh.name}>
                  {sh.name} ({fmt(sh.rows)} baris)
                </option>
              ))}
            </select>{" "}
            <span className="muted">Hanya satu sheet yang disimpan.</span>
          </div>
        ) : undefined
      }
      modeText={
        mg ? (
          <>
            ⟳ <b>Tambah / perbarui</b> (dicocokkan dengan Serial Number): <b>{fmt(mg.updated)}</b> unit diperbarui, <b>{fmt(mg.added)}</b> unit baru.
            Unit lain di database ({fmt(Math.max(mg.existing - mg.updated, 0))}) tidak diubah.
            {mg.noSerial > 0 && <> ⚠ <b>{fmt(mg.noSerial)} baris tanpa Serial Number</b> tidak disimpan (gunakan Ganti semua bila perlu).</>}
          </>
        ) : (
          <>
            ⟲ <b>Ganti semua</b>: isi file ini menjadi Data UIO yang baru. Unit lama yang tidak ada di file akan <b>dihapus</b> (setelah semua unit baru tersimpan).
          </>
        )
      }
    />
  );
}

/** Pilihan cara upload — sama untuk semua jenis data. */
function ModeChoice({ name, mode, onChange, matchBy, busy }: { name: string; mode: Mode; onChange: (m: Mode) => void; matchBy: string; busy: boolean }) {
  return (
    <div className="upload-mode">
      <div className="upload-mode-opts" role="radiogroup" aria-label="Cara upload">
        <span className="upload-mode-label">Cara upload:</span>
        <label
          className={mode === "merge" ? "on" : ""}
          title={`Dicocokkan per ${matchBy}: yang sudah ada diperbarui, yang baru ditambahkan, data lain tidak diubah.`}
        >
          <input type="radio" name={name} checked={mode === "merge"} disabled={busy} onChange={() => onChange("merge")} />
          Tambah / perbarui
        </label>
        <label
          className={mode === "replace" ? "on replace" : ""}
          title="Isi file menjadi data lengkap: data lama yang tidak ada di file dihapus (setelah isi file tersimpan)."
        >
          <input type="radio" name={name} checked={mode === "replace"} disabled={busy} onChange={() => onChange("replace")} />
          Ganti semua
        </label>
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
  extra,
  mode,
  onMode,
  matchBy,
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
  /** Dipanggil setelah file dipilih — file DIPERIKSA dulu, belum disimpan. */
  onPick: (file: File, mode: Mode) => void;
  onTemplate?: () => void;
  mode: Mode;
  onMode: (m: Mode) => void;
  /** Kunci pencocokan mode tambah / perbarui, mis. "Serial Number". */
  matchBy: string;
  /** Panel pemeriksaan file (tampil di atas tombol Pilih File). */
  extra?: React.ReactNode;
  accept?: string;
}) {
  const when = fmtDate(updatedAt);
  return (
    <div className="upload-slot">
      <h4>{title}</h4>
      {hint && <div className="hint">{hint}</div>}
      <ModeChoice name={`mode-${title}`} mode={mode} onChange={onMode} matchBy={matchBy} busy={busy} />
      {extra}
      <div className="upload-row upload-file-row">
        <input
          type="file"
          className="file-input"
          accept={accept}
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPick(f, mode);
            e.target.value = "";
          }}
        />
        <span className="last-file" title={lastFile ? `${lastFile}${when ? ` · ${when}` : ""} · ${fmt(count)} ${countUnit} tersimpan` : undefined}>
          {lastFile ? (
            <>
              File terakhir: <b>{lastFile}</b>
              {when ? ` · ${when}` : ""} · {fmt(count)} {countUnit}
            </>
          ) : count > 0 ? (
            `${fmt(count)} ${countUnit} tersimpan`
          ) : (
            "Belum ada data"
          )}
        </span>
      </div>
      <div className="slot-actions">
        {onTemplate && (
          <button type="button" className="slot-btn" onClick={onTemplate}>
            ⤓ Unduh template
          </button>
        )}
        {download && count > 0 && <DownloadButton kind={download} busy={busy} />}
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
  meta,
  lists = EMPTY_LISTS
}: {
  open: boolean;
  onClose: () => void;
  onUploaded: () => Promise<void> | void;
  counts: UploadCounts;
  meta: DataMeta;
  /** Daftar pilihan untuk dropdown template & pengecekan ejaan saat upload. */
  lists?: TemplateLists;
}) {
  const [stUio, setStUio] = useState<SlotStatus>(null);
  const [uioPending, setUioPending] = useState<UioPrepared | null>(null);
  const uioFileRef = useRef<{ file: File; mode: Mode } | null>(null);
  const [stPart, setStPart] = useState<SlotStatus>(null);
  const [stContract, setStContract] = useState<SlotStatus>(null);
  const [stNonContract, setStNonContract] = useState<SlotStatus>(null);
  const [stSync, setStSync] = useState<SlotStatus>(null);
  const [masterOpen, setMasterOpen] = useState(false);
  // File Harga / Master Part yang sudah diperiksa, menunggu keputusan "Lanjutkan upload" / "Perbaiki file".
  type Pend = { file: File; mode: Mode; check: FileCheck } | null;
  const [pend, setPend] = useState<Record<CheckKind, Pend>>({ contract: null, non_contract: null, parts: null });
  // Cara upload per jenis data — bawaan "Tambah / perbarui" (tidak menghapus apa pun).
  const [modes, setModes] = useState<Record<"uio" | "contract" | "non_contract" | "parts", Mode>>({
    uio: "merge",
    contract: "merge",
    non_contract: "merge",
    parts: "merge"
  });
  const setMode = (k: keyof typeof modes) => (m: Mode) => setModes((prev) => ({ ...prev, [k]: m }));
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
        : `Mode ganti semua: ${fmt(j.removed ?? 0)} unit lama yang tidak ada di file dihapus.${typeof j.totalInDb === "number" ? ` Total Data UIO sekarang ${fmt(j.totalInDb)} unit.` : ""}`
    }`;

  /** Ringkasan hasil upload yang sama untuk Harga & Master Part. */
  const mergeText = (j: any, unit: string) =>
    ` ${fmt(j.updated ?? 0)} diperbarui, ${fmt(j.added ?? 0)} baru${j.mode === "replace" ? `, ${fmt(j.removed ?? 0)} ${unit} lama dihapus` : ""}.${
      typeof j.totalInDb === "number" ? ` Total sekarang ${fmt(j.totalInDb)} ${unit}.` : ""
    }`;

  /** Data UIO: periksa file dulu. Kalau ada masalah, tampilkan ringkasan dan tunggu keputusan pengguna. */
  async function pickUio(f: File, mode: Mode, sheet?: string) {
    setUioPending(null);
    setBusy(true);
    setStUio({ text: "Memeriksa file (bisa beberapa puluh detik)…", ok: true });
    uioFileRef.current = { file: f, mode };
    const r = await prepareUioUpload(f, mode as UioUploadMode, sheet, lists);
    setBusy(false);
    if (!r.ok) {
      setStUio({ text: "Gagal: " + r.message, ok: false });
      return;
    }
    const v = r.prep.validation;
    // Selalu tampilkan hasil pemeriksaan dulu; data baru disimpan setelah "Lanjutkan upload".
    void v;
    setStUio(null);
    setUioPending(r.prep);
  }

  /** Harga / Master Part: periksa file dulu (baris dobel, harga berbeda, kolom kosong, …), belum disimpan. */
  async function pickChecked(kind: CheckKind, setStatus: (s: SlotStatus) => void, f: File, mode: Mode) {
    setPend((p) => ({ ...p, [kind]: null }));
    setBusy(true);
    setStatus({ text: "Memeriksa file…", ok: true });
    try {
      const check = await checkUploadFile(f, kind, lists);
      setPend((p) => ({ ...p, [kind]: { file: f, mode, check } }));
      setStatus(null);
    } catch (err) {
      setStatus({ text: "Gagal membaca file: " + ((err as Error).message || "file tidak terbaca"), ok: false });
    }
    setBusy(false);
  }
  const modeTextOf = (m: Mode, count: number, unit: string, matchBy: string) =>
    m === "merge" ? (
      <>⟳ <b>Tambah / perbarui</b> (dicocokkan per {matchBy}): yang sudah ada diperbarui, yang baru ditambahkan, data lain tidak diubah.</>
    ) : (
      <>⟲ <b>Ganti semua</b>: isi file ini menjadi data {unit} yang baru — {fmt(count)} {unit} lama yang tidak ada di file akan <b>dihapus</b> (setelah isi file tersimpan).</>
    );
  function checkPanel(kind: CheckKind, setStatus: (s: SlotStatus) => void, count: number, unit: string, matchBy: string, commit: (f: File, m: Mode) => void) {
    const pd = pend[kind];
    if (!pd) return null;
    return (
      <CheckPanel
        title={<>Pemeriksaan file <b>{pd.file.name}</b>: {fmt(pd.check.rowCount)} baris siap disimpan dari {fmt(pd.check.totalRows)} baris (sheet &quot;{pd.check.sheet}&quot;).</>}
        validation={pd.check}
        modeText={modeTextOf(pd.mode, count, unit, matchBy)}
        busy={busy}
        onContinue={() => {
          setPend((p) => ({ ...p, [kind]: null }));
          commit(pd.file, pd.mode);
        }}
        onCancel={() => {
          setPend((p) => ({ ...p, [kind]: null }));
          setStatus({ text: "Upload dibatalkan — tidak ada data yang diubah. Perbaiki file lalu pilih file lagi.", ok: false });
        }}
      />
    );
  }

  const skippedText = (j: any) => (j.skipped ? ` (${j.skipped} baris dilewati.)` : "");
  const dupText = (j: any) => (j.duplicates ? ` (${j.duplicates} baris kembar digabung.)` : "");

  // Data yang wajib ada supaya market size bisa dihitung.
  const missing = [
    counts.uioUnits === 0 ? "Data UIO" : null,
    counts.contractPrices + counts.nonContractPrices === 0 ? "Data Harga" : null,
    counts.parts === 0 ? "Master Part" : null
  ].filter(Boolean) as string[];

  const modeTag = (m: string | null | undefined) => (m === "merge" ? " (tambah/perbarui)" : m === "replace" ? " (ganti semua)" : "");
  // Upload terakhir per jenis harga. Data lama (sebelum dicatat terpisah) hanya dipakai kalau jenisnya cocok.
  const priceFile = (t: "contract" | "non_contract") => {
    const f = t === "contract" ? meta.price_contract_filename : meta.price_non_contract_filename;
    const m = t === "contract" ? meta.price_contract_mode : meta.price_non_contract_mode;
    if (f) return `${f}${modeTag(m)}`;
    return meta.price_list_type === t ? meta.price_list_filename : null;
  };
  const priceAt = (t: "contract" | "non_contract") => {
    const f = t === "contract" ? meta.price_contract_filename : meta.price_non_contract_filename;
    if (f) return t === "contract" ? meta.price_contract_updated_at : meta.price_non_contract_updated_at;
    return meta.price_list_type === t ? meta.price_list_updated_at : null;
  };
  const syncedAt = meta.actual_year_synced_at ? new Date(meta.actual_year_synced_at) : null;
  const dataUntil = meta.actual_year_max_date ? new Date(meta.actual_year_max_date) : null;

  return (
    <ListsCtx.Provider value={lists}>
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
          lastFile={meta.uio_units_filename ? `${meta.uio_units_filename}${modeTag(meta.uio_units_mode)}` : null}
          updatedAt={meta.uio_units_updated_at}
          download="uio"
          status={stUio}
          busy={busy}
          onPick={pickUio}
          mode={modes.uio}
          onMode={setMode("uio")}
          matchBy="Product + Serial Number"
          extra={
            <>
            {uioPending && (
              <UioCheck
                prep={uioPending}
                busy={busy}
                onContinue={() => {
                  const prep = uioPending;
                  setUioPending(null);
                  run(setStUio, () => prep.commit((t) => setStUio({ text: t, ok: true })), uioDoneText);
                }}
                onSheet={(sh) => {
                  const last = uioFileRef.current;
                  if (last) pickUio(last.file, last.mode, sh);
                }}
                onCancel={() => {
                  setUioPending(null);
                  setStUio({ text: "Upload dibatalkan — tidak ada data yang diubah.", ok: false });
                }}
              />
            )}
            </>
          }
          onTemplate={() => downloadUioTemplate(lists)}
        />

        <Slot
          title="2. Data Harga Kontrak / SCPL"
          count={counts.contractPrices}
          countUnit="harga kontrak / SCPL"
          lastFile={priceFile("contract")}
          updatedAt={priceAt("contract")}
          mode={modes.contract}
          onMode={setMode("contract")}
          matchBy="Part Number + Customer Code + Price Type"
          download="contract"
          status={stContract}
          busy={busy}
          extra={checkPanel("contract", setStContract, counts.contractPrices, "harga kontrak / SCPL", "Part Number + Customer Code + Price Type", (f, m) =>
            run(setStContract, () => uploadFile("/api/upload/price-contract", f, m), (j) =>
              `Berhasil: ${fmt(j.rowCount)} harga kontrak / SCPL dari file${j.noCode ? ` (${fmt(j.noCode)} baris tanpa Cust. Code dilewati — Customer Code wajib)` : ""}${typeof j.scpl === "number" ? ` (${fmt(j.rowCount - j.scpl)} Kontrak, ${fmt(j.scpl)} SCPL)` : ""} —${mergeText(j, "harga")}${dupText(j)}${skippedText(j)}`
            )
          )}
          onPick={(f, m) => pickChecked("contract", setStContract, f, m)}
          onTemplate={() => downloadContractPriceTemplate(lists)}
        />

        <Slot
          title="3. Data Harga Non Kontrak"
          count={counts.nonContractPrices}
          countUnit="harga non kontrak"
          lastFile={priceFile("non_contract")}
          updatedAt={priceAt("non_contract")}
          mode={modes.non_contract}
          onMode={setMode("non_contract")}
          matchBy="Part Number"
          download="non_contract"
          status={stNonContract}
          busy={busy}
          extra={checkPanel("non_contract", setStNonContract, counts.nonContractPrices, "harga non kontrak", "Part Number", (f, m) =>
            run(setStNonContract, () => uploadFile("/api/upload/price-non-contract", f, m), (j) =>
              `Berhasil: ${fmt(j.rowCount)} harga non kontrak dari file (harga − ${Math.round((typeof j.discount === "number" ? j.discount : 0.5) * 100)}%) —${mergeText(j, "harga non kontrak")}${dupText(j)}${skippedText(j)}`
            )
          )}
          onPick={(f, m) => pickChecked("non_contract", setStNonContract, f, m)}
          onTemplate={() => downloadNonContractPriceTemplate(lists)}
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
            lastFile={meta.kalkulator_filename ? `${meta.kalkulator_filename}${modeTag(meta.kalkulator_mode)}` : null}
            updatedAt={meta.kalkulator_updated_at}
            mode={modes.parts}
            onMode={setMode("parts")}
            matchBy="Product + Model + Part Number"
            download="parts"
            status={stPart}
            busy={busy}
            extra={checkPanel("parts", setStPart, counts.parts, "part", "Product + Model + Part Number", (f, m) =>
              run(setStPart, () => uploadMasterPart(f, (t) => setStPart({ text: t, ok: true }), m), (j) =>
                `Berhasil: ${fmt(j.rowCount)} part dari file —${mergeText(j, "part")}${dupText(j)}${skippedText(j)}`
              )
            )}
            onPick={(f, m) => pickChecked("parts", setStPart, f, m)}
            onTemplate={() => downloadMasterPartTemplate(lists)}
            accept=".xlsx,.xls,.csv"
          />
        )}

        <div className="upload-group-title">Otomatis — tidak perlu upload</div>

        <div className="upload-slot">
          <h4>Actual Sales — tersinkron dari web Sales</h4>
          <div className="hint">
            Diambil otomatis tiap jam dari data penjualan di web Sales — admin cukup menginput di web Sales, tidak perlu menekan tombol apa pun.
          </div>
          <div className="last-file" style={{ marginBottom: 8 }}>
            {syncedAt
              ? `Sinkron terakhir: ${syncedAt.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}` +
                `${dataUntil ? ` · data web Sales sampai ${dataUntil.toLocaleDateString("id-ID", { dateStyle: "medium" })}` : ""}`
              : "Belum pernah sinkron"}
          </div>
          <div className="slot-actions">
            <button
              type="button"
              className="slot-btn"
              disabled={busy}
              title="Tidak wajib — sinkron otomatis jalan tiap jam. Pakai kalau baru input di web Sales dan ingin langsung terlihat."
              onClick={() => run(setStSync, () => syncActualSales("recent", (t) => setStSync({ text: t, ok: true })), (m) => `Berhasil. ${m}`)}
            >
              ⟳ Sinkron sekarang
            </button>
            {counts.actualSales > 0 && (
              <DownloadButton kind="actual" busy={busy} title="Unduh Actual per tahun × customer × product (dengan rincian bulan) untuk dicocokkan dengan web Sales." />
            )}
            <button
              type="button"
              className="slot-btn"
              disabled={busy}
              title="Mengisi ulang Actual semua tahun sejak 2018 (beberapa menit). Perlu setelah update aturan/rumus atau kalau data lama di web Sales dikoreksi."
              onClick={() => run(setStSync, () => syncActualSales("all", (t) => setStSync({ text: t, ok: true })), (m) => `Berhasil. ${m}`)}
            >
              ⟳ Sinkron ulang semua tahun
            </button>
          </div>
          {stSync && <div className={"upload-status " + (stSync.ok ? "ok" : "err")}>{stSync.text}</div>}
        </div>
      </div>
    </div>
    </ListsCtx.Provider>
  );
}
