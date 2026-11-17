"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { EMPTY_LISTS, type TemplateLists } from "@/lib/downloadTemplates";

/** Daftar pilihan dropdown template (dari data website). */
const ListsCtx = createContext<TemplateLists>(EMPTY_LISTS);
import {
  downloadUioTemplate,
  downloadContractPriceTemplate,
  downloadNonContractPriceTemplate,
  downloadMasterPartTemplate
} from "@/lib/downloadTemplates";
import { uploadMasterPart, uploadPricesChunked, prepareUioUpload, type UioPrepared, type UioUploadMode } from "@/lib/parse/uploadChunked";
import { downloadCurrentData, type DownloadKind } from "@/lib/downloadCurrent";
import { checkUploadFile, type CheckKind, type ExistingPrices, type FileCheck } from "@/lib/parse/fileCheck";
import { branchCodes, signInUpload, type UploadAuth } from "@/lib/uploadAuthClient";
import { normCode } from "@/lib/priceType";
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
type Tab = "uio" | "price" | "parts" | "actual" | "admin";

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
    rows.length === 0 ? "" : ` (baris ${rows.join(", ")}${count > rows.length ? `, … (+${fmt(count - rows.length)} lainnya)` : ""})`;
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
          ⚠ <b>{fmt(i.count)} baris</b> — {i.message} <span className="uio-check-rows">{rowsText(i.rows, i.count)}</span>
        </div>
      ))}
      {info.map((i) => (
        <div className="uio-check-row muted" key={i.message}>
          ℹ {fmt(i.count)} baris — {i.message} <span className="uio-check-rows">{rowsText(i.rows, i.count)}</span>
        </div>
      ))}
      {!problem && info.length === 0 && <div className="uio-check-row muted">Tidak ada baris dobel atau bermasalah.</div>}
      <div className="upload-row">
        <button type="button" className={problem ? "danger-btn" : "primary-btn"} disabled={busy} onClick={() => onContinue()}>
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
        prep.mode === "branch_add" && mg ? (
          <>
            ＋ <b>Tambah unit baru — cabang {mg.branch}</b>: <b>{fmt(mg.added)}</b> unit baru akan disimpan. Unit yang sudah ada di website tidak diubah
            {(mg.exists ?? 0) + (mg.otherBranch ?? 0) + mg.noSerial > 0 && (
              <>
                {" "}— <b>{fmt((mg.exists ?? 0) + (mg.otherBranch ?? 0) + mg.noSerial)} baris tidak disimpan</b> (rinciannya di bawah)
              </>
            )}
            .
          </>
        ) : mg ? (
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

/** Pilihan cara upload — keterangan langsung di label supaya tidak salah paham. */
function ModeChoice({ name, mode, onChange, matchBy, busy, unit }: { name: string; mode: Mode; onChange: (m: Mode) => void; matchBy: string; busy: boolean; unit: string }) {
  return (
    <div className="mode-cards" role="radiogroup" aria-label="Cara upload">
      <label className={"mode-card" + (mode === "merge" ? " on" : "")}>
        <input type="radio" name={name} checked={mode === "merge"} disabled={busy} onChange={() => onChange("merge")} />
        <span>
          <b>Tambah / perbarui</b> <span className="mode-tag">disarankan</span>
          <span className="mode-desc">
            Dicocokkan per {matchBy}: yang sudah ada diperbarui, yang baru ditambahkan. {unit} lain di website <b>tidak berubah</b>.
          </span>
        </span>
      </label>
      <label className={"mode-card danger" + (mode === "replace" ? " on" : "")}>
        <input type="radio" name={name} checked={mode === "replace"} disabled={busy} onChange={() => onChange("replace")} />
        <span>
          <b>Ganti semua</b>
          <span className="mode-desc">
            Isi file dianggap data lengkap — {unit} di website yang <b>tidak ada di file akan dihapus</b>. Pakai hanya bila file berisi seluruh data.
          </span>
        </span>
      </label>
    </div>
  );
}

/** Satu jenis data: info data saat ini, lalu langkah ① siapkan file ② cara upload ③ pilih file. */
function DataCard({
  title,
  desc,
  count,
  countUnit,
  lastFile,
  updatedAt,
  download,
  onTemplate,
  templateLabel = "⤓ Unduh template",
  mode,
  status,
  busy,
  onPick,
  extra,
  accept = ".xlsx,.xls",
  children,
  showCount = true
}: {
  title: string;
  desc?: React.ReactNode;
  count: number;
  countUnit: string;
  lastFile?: string | null;
  updatedAt?: string | null;
  download?: DownloadKind;
  onTemplate?: () => void;
  templateLabel?: string;
  /** Langkah ② (pilihan cara upload, atau teks tetap untuk akun cabang). */
  mode: React.ReactNode;
  status: SlotStatus;
  busy: boolean;
  onPick: (file: File) => void;
  /** Hasil pemeriksaan file (tampil setelah file dipilih). */
  extra?: React.ReactNode;
  accept?: string;
  /** Isi tambahan di atas langkah (mis. pilihan jenis harga). */
  children?: React.ReactNode;
  /** false = tanpa label jumlah data (akun cabang: jumlah total semua cabang bisa membingungkan). */
  showCount?: boolean;
}) {
  const when = fmtDate(updatedAt);
  return (
    <div className="data-card">
      <div className="data-card-head">
        <h4>{title}</h4>
        {showCount && <span className={"data-badge" + (count > 0 ? " ok" : " empty")}>{count > 0 ? `${fmt(count)} ${countUnit}` : "Belum ada data"}</span>}
      </div>
      {desc && <div className="hint">{desc}</div>}
      {lastFile && (
        <div className="hint">
          File terakhir: <b>{lastFile}</b>
          {when ? ` · ${when}` : ""}
        </div>
      )}
      {children}
      <div className="step">
        <span className="step-no">1</span>
        <div className="step-body">
          <div className="step-title">Siapkan file</div>
          <div className="slot-actions">
            {onTemplate && (
              <button type="button" className="slot-btn" onClick={onTemplate}>
                {templateLabel}
              </button>
            )}
            {download && count > 0 && <DownloadButton kind={download} busy={busy} />}
          </div>
        </div>
      </div>
      <div className="step">
        <span className="step-no">2</span>
        <div className="step-body">
          <div className="step-title">Cara upload</div>
          {mode}
        </div>
      </div>
      <div className="step">
        <span className="step-no">3</span>
        <div className="step-body">
          <div className="step-title">Pilih file — diperiksa dulu, belum disimpan</div>
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
          {extra}
          {status && <div className={"upload-status " + (status.ok ? "ok" : "err")}>{status.text}</div>}
        </div>
      </div>
    </div>
  );
}

/** Masuk sebagai admin (PIN) atau cabang (kode akses cabang). Dicek ke server; tidak mengubah data apa pun. */
function SignIn({ branches, auth, onAuth, busy }: { branches: string[]; auth: UploadAuth | null; onAuth: (a: UploadAuth | null) => void; busy: boolean }) {
  const [role, setRole] = useState<"branch" | "admin">("branch");
  const [branch, setBranch] = useState("");
  const [secret, setSecret] = useState("");
  const [state, setState] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
  if (auth) return null;
  const go = async () => {
    const a: UploadAuth = role === "admin" ? { role: "admin", pin: secret } : { role: "branch", branch, code: secret.trim().toUpperCase() };
    setState({ loading: true, error: null });
    const r = await signInUpload(a);
    if (!r.ok) {
      setState({ loading: false, error: r.error });
      return;
    }
    setState({ loading: false, error: null });
    setSecret("");
    onAuth(a.role === "branch" ? { ...a, branch: r.branch || a.branch } : a);
  };
  const ready = !!secret && (role === "admin" || !!branch);
  return (
    <div className="signin">
      <div className="signin-title">Masuk untuk upload data</div>
      <div className="upload-mode-opts" role="radiogroup" aria-label="Masuk sebagai">
        <label className={role === "branch" ? "on" : ""}>
          <input type="radio" checked={role === "branch"} onChange={() => setRole("branch")} /> Cabang
        </label>
        <label className={role === "admin" ? "on" : ""}>
          <input type="radio" checked={role === "admin"} onChange={() => setRole("admin")} /> Admin
        </label>
      </div>
      <div className="signin-row">
        {role === "branch" && (
          <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Cabang">
            <option value="">Pilih cabang…</option>
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        )}
        <input
          type="password"
          className="pin-input"
          placeholder={role === "admin" ? "PIN admin" : "Kode akses cabang"}
          value={secret}
          autoComplete="off"
          onChange={(e) => setSecret(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ready && go()}
        />
        <button type="button" className="primary-btn" disabled={!ready || state.loading} onClick={go}>
          {state.loading ? "Memeriksa…" : "Masuk"}
        </button>
      </div>
      <div className="hint">
        {role === "branch"
          ? "Kode akses cabang diberikan oleh admin. Akun cabang hanya bisa menambah unit baru untuk cabangnya sendiri."
          : "PIN admin dibutuhkan untuk mengubah, mengganti, atau menghapus data, serta upload Data Harga dan Master Part."}
      </div>
      {state.error && <div className="upload-status err">{state.error}</div>}
    </div>
  );
}

/** Admin: buat / cabut kode akses cabang, dan lihat riwayat upload. */
function AdminPanel({ pin, branches }: { pin: string; branches: string[] }) {
  const [list, setList] = useState<{ branch: string; updated_at: string }[] | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [fresh, setFresh] = useState<{ branch: string; code: string } | null>(null);
  const [pick, setPick] = useState("");
  const [log, setLog] = useState<any[] | null>(null);
  const load = async () => {
    try {
      const j = await branchCodes(pin, "list");
      setList(j.branches || []);
      setMsg(null);
    } catch (err) {
      setMsg({ text: (err as Error).message, ok: false });
    }
    try {
      const { supabaseBrowser } = await import("@/lib/supabase/client");
      const { data } = await supabaseBrowser.from("upload_log").select("*").order("created_at", { ascending: false }).limit(15);
      setLog(data || []);
    } catch {
      setLog([]);
    }
  };
  const act = async (action: "set" | "remove", b: string) => {
    setFresh(null);
    try {
      const j = await branchCodes(pin, action, b);
      if (action === "set") setFresh({ branch: j.branch, code: j.code });
      else setMsg({ text: `Akses cabang ${b} dicabut.`, ok: true });
      await load();
    } catch (err) {
      setMsg({ text: (err as Error).message, ok: false });
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const has = new Set((list || []).map((x) => x.branch));
  const KIND: Record<string, string> = { uio: "Data UIO", price_contract: "Harga Kontrak", price_non_contract: "Harga Non Kontrak", parts: "Master Part" };
  const MODE: Record<string, string> = { merge: "tambah/perbarui", replace: "ganti semua", branch_add: "tambah unit (cabang)" };
  return (
    <>
      {(
        <div className="data-card">
          <h4>Kode akses cabang</h4>
          <div className="hint">
            Buat kode untuk tiap cabang lalu berikan ke orang cabang. Kode hanya tampil sekali (yang disimpan hanya sandinya). Membuat kode baru otomatis
            membatalkan kode lama.
          </div>
          <div className="signin-row">
            <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Cabang">
              <option value="">Pilih cabang…</option>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                  {has.has(b) ? " (sudah punya kode)" : ""}
                </option>
              ))}
            </select>
            <button type="button" className="slot-btn" disabled={!pick} onClick={() => act("set", pick)}>
              {has.has(pick) ? "Buat kode baru" : "Buat kode"}
            </button>
            {has.has(pick) && (
              <button type="button" className="link-btn" onClick={() => act("remove", pick)}>
                Cabut akses
              </button>
            )}
          </div>
          {fresh && (
            <div className="upload-status ok">
              Kode akses cabang <b>{fresh.branch}</b>: <b className="mono" style={{ fontSize: 15, letterSpacing: 1 }}>{fresh.code}</b> — catat dan berikan ke orang cabang
              sekarang; kode ini tidak bisa dilihat lagi.
            </div>
          )}
          {list && list.length > 0 && (
            <div className="hint">Cabang yang punya akses: {list.map((x) => x.branch).join(", ")}</div>
          )}
          {msg && <div className={"upload-status " + (msg.ok ? "ok" : "err")}>{msg.text}</div>}
          </div>
      )}
      {(
        <div className="data-card">
          <h4>Riwayat upload terakhir</h4>
          {log === null ? (
            <div className="hint">Memuat…</div>
          ) : log.length === 0 ? (
            <div className="hint">Belum ada catatan (atau migration v28 belum dijalankan).</div>
          ) : (
            <table className="upload-log">
              <thead>
                <tr>
                  <th>Waktu</th>
                  <th>Oleh</th>
                  <th>Data</th>
                  <th>File</th>
                  <th>Disimpan</th>
                  <th>Keterangan</th>
                </tr>
              </thead>
              <tbody>
                {log.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtDate(r.created_at)}</td>
                    <td>{r.role === "cabang" ? `Cabang ${r.branch}` : "Admin"}</td>
                    <td>
                      {KIND[r.kind] || r.kind}
                      {r.mode ? ` · ${MODE[r.mode] || r.mode}` : ""}
                    </td>
                    <td>{r.filename || "-"}</td>
                    <td>{typeof r.rows_saved === "number" ? fmt(r.rows_saved) : "-"}</td>
                    <td>{r.note || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}

/** Harga yang sudah ada di database (kunci sama dengan pemeriksaan file) — untuk ringkasan "harga berubah". */
async function existingPrices(kind: "contract" | "non_contract"): Promise<ExistingPrices | null> {
  try {
    const { supabaseBrowser } = await import("@/lib/supabase/client");
    const { fetchAll } = await import("@/lib/fetchDashboardDataShared");
    const rows = await fetchAll<any>(supabaseBrowser, "price_list", "id", "id, part_number, customer_code, customer_group, price_type, price, list_price");
    const m: ExistingPrices = new Map();
    rows.forEach((r) => {
      const pn = String(r.part_number || "").trim().toUpperCase();
      const t = r.price_type === "scpl" ? "scpl" : r.price_type === "contract" ? "contract" : null;
      const isContract = !!t || (!!String(r.customer_group || "").trim() && r.price_type !== "non_contract");
      if (kind === "contract" && isContract) {
        const code = normCode(r.customer_code);
        if (code) m.set(`${code}|${pn}|${t || "contract"}`, Number(r.price) || 0);
      } else if (kind === "non_contract" && !isContract) {
        const list = r.list_price !== null && r.list_price !== undefined ? Number(r.list_price) : (Number(r.price) || 0) / 0.5;
        m.set(pn, list);
      }
    });
    return m;
  } catch {
    return null;
  }
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
  // Siapa yang upload (disimpan di memori selama halaman terbuka; tidak disimpan di browser).
  const [auth, setAuth] = useState<UploadAuth | null>(null);
  const [tab, setTab] = useState<Tab>("uio");
  const [priceKind, setPriceKind] = useState<"contract" | "non_contract">("contract");

  if (!open) return null;
  const isAdm = auth?.role === "admin";
  const isBranch = auth?.role === "branch";
  const pin = auth?.role === "admin" ? auth.pin : "";
  const pacBranches = lists.branches.filter((b) => !(lists.excludedBranches || []).includes(b));

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
    j.mode === "branch_add"
      ? `Berhasil: ${fmt(j.rowCount)} unit baru cabang ${j.merge?.branch ?? ""} disimpan.${
          (j.serverRejected?.exists ?? 0) > 0 ? ` ${fmt(j.serverRejected.exists)} unit ternyata sudah ada (tidak diubah).` : ""
        }${
          typeof j.totalInDb === "number" ? ` Total Data UIO sekarang ${fmt(j.totalInDb)} unit.` : ""
        } Untuk mengubah / menghapus unit, hubungi admin.`
      : `Berhasil: ${fmt(j.rowCount)} unit disimpan (sheet "${j.sheet}"). Nama customer: ${fmt(j.exact)} sudah cocok, ${fmt(j.remapped)} disamakan dengan Master Customer, ${fmt(j.unmatched)} tidak ditemukan di master.${
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
    if (!auth) return;
    const r = await prepareUioUpload(f, (auth.role === "branch" ? "branch_add" : mode) as UioUploadMode, sheet, lists, auth);
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
      const existing = kind === "parts" ? null : await existingPrices(kind);
      const check = await checkUploadFile(f, kind, lists, existing);
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
  function checkPanel(kind: CheckKind, setStatus: (s: SlotStatus) => void, count: number, unit: string, matchBy: string, commit: (f: File, m: Mode, pin: string) => void) {
    if (!isAdm) return null;
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
          commit(pd.file, pd.mode, pin);
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

  const uioCard = (
    <DataCard
      title={isBranch ? `Tambah unit Data UIO — cabang ${auth.branch}` : "Data UIO"}
      desc={
        isBranch ? (
          <>
            Unit baru cabang {auth.branch} saja. Unit yang sudah ada di website tidak bisa diubah dari akun cabang — hubungi admin untuk mengubah / menghapus.
          </>
        ) : (
          "Populasi unit per customer (Product, Model, Serial Number, Year/Month BAST, jam operasi)."
        )
      }
      count={counts.uioUnits}
      countUnit="unit"
      showCount={!isBranch}
      lastFile={isBranch ? null : meta.uio_units_filename ? `${meta.uio_units_filename}${modeTag(meta.uio_units_mode)}` : null}
      updatedAt={meta.uio_units_updated_at}
      download={isBranch ? undefined : "uio"}
      onTemplate={() => downloadUioTemplate(lists, isBranch ? auth.branch : null)}
      templateLabel={isBranch ? `⤓ Unduh template cabang ${auth.branch}` : "⤓ Unduh template"}
      mode={
        isBranch ? (
          <div className="mode-fixed">
            <b>Tambah unit baru</b> — hanya unit cabang {auth.branch} yang belum ada di website (Product + Model + Serial Number). Kolom Branch boleh kosong.
          </div>
        ) : (
          <ModeChoice name="mode-uio" mode={modes.uio} onChange={setMode("uio")} matchBy="Product + Model + Serial Number" busy={busy} unit="Unit" />
        )
      }
      status={stUio}
      busy={busy}
      onPick={(f) => pickUio(f, modes.uio)}
      extra={
        uioPending && (
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
        )
      }
    />
  );

  const pk = priceKind;
  const priceCard = (
    <DataCard
      key={pk}
      title={pk === "contract" ? "Data Harga Kontrak / SCPL" : "Data Harga Non Kontrak"}
      desc={
        pk === "contract"
          ? "Harga nett per Customer Code + Part Number (dipakai untuk unit ber-Price Type Kontrak / SCPL)."
          : "Harga tertera (pricelist) per Part Number — sistem otomatis memotong 50% (sesuai pengaturan) saat upload."
      }
      count={pk === "contract" ? counts.contractPrices : counts.nonContractPrices}
      countUnit="harga"
      lastFile={priceFile(pk)}
      updatedAt={priceAt(pk)}
      download={pk}
      onTemplate={() => (pk === "contract" ? downloadContractPriceTemplate(lists) : downloadNonContractPriceTemplate(lists))}
      mode={
        <ModeChoice
          name={`mode-${pk}`}
          mode={modes[pk]}
          onChange={setMode(pk)}
          matchBy={pk === "contract" ? "Customer Code + Part Number + Price Type" : "Part Number"}
          busy={busy}
          unit="Harga"
        />
      }
      status={pk === "contract" ? stContract : stNonContract}
      busy={busy}
      onPick={(f) => pickChecked(pk, pk === "contract" ? setStContract : setStNonContract, f, modes[pk])}
      extra={
        pk === "contract"
          ? checkPanel("contract", setStContract, counts.contractPrices, "harga kontrak / SCPL", "Part Number + Customer Code + Price Type", (f, m, p) =>
              run(setStContract, () => uploadPricesChunked("contract", f, m, p, (t) => setStContract({ text: t, ok: true })), (j) =>
                `Berhasil: ${fmt(j.rowCount)} harga kontrak / SCPL dari file${j.noCode ? ` (${fmt(j.noCode)} baris tanpa Cust. Code dilewati — Customer Code wajib)` : ""}${typeof j.scpl === "number" ? ` (${fmt(j.rowCount - j.scpl)} Kontrak, ${fmt(j.scpl)} SCPL)` : ""} —${mergeText(j, "harga")}${dupText(j)}${skippedText(j)}`
              )
            )
          : checkPanel("non_contract", setStNonContract, counts.nonContractPrices, "harga non kontrak", "Part Number", (f, m, p) =>
              run(setStNonContract, () => uploadPricesChunked("non_contract", f, m, p, (t) => setStNonContract({ text: t, ok: true })), (j) =>
                `Berhasil: ${fmt(j.rowCount)} harga non kontrak dari file (harga − ${Math.round((typeof j.discount === "number" ? j.discount : 0.5) * 100)}%) —${mergeText(j, "harga non kontrak")}${dupText(j)}${skippedText(j)}`
              )
            )
      }
    >
      <div className="seg" role="tablist" aria-label="Jenis harga">
        {(["contract", "non_contract"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={pk === k} className={pk === k ? "on" : ""} disabled={busy} onClick={() => setPriceKind(k)}>
            {k === "contract" ? `Kontrak / SCPL (${fmt(counts.contractPrices)})` : `Non Kontrak (${fmt(counts.nonContractPrices)})`}
          </button>
        ))}
      </div>
    </DataCard>
  );

  const partsCard = (
    <DataCard
      title="Master Part"
      desc="Daftar part per model: Qty per Unit dan Frekuensi Ganti (HM). Jarang berubah — upload hanya bila ada part / model baru atau koreksi."
      count={counts.parts}
      countUnit="part"
      lastFile={meta.kalkulator_filename ? `${meta.kalkulator_filename}${modeTag(meta.kalkulator_mode)}` : null}
      updatedAt={meta.kalkulator_updated_at}
      download="parts"
      onTemplate={() => downloadMasterPartTemplate(lists)}
      mode={<ModeChoice name="mode-parts" mode={modes.parts} onChange={setMode("parts")} matchBy="Product + Model + Part Number" busy={busy} unit="Part" />}
      status={stPart}
      busy={busy}
      accept=".xlsx,.xls,.csv"
      onPick={(f) => pickChecked("parts", setStPart, f, modes.parts)}
      extra={checkPanel("parts", setStPart, counts.parts, "part", "Product + Model + Part Number", (f, m, p) =>
        run(setStPart, () => uploadMasterPart(f, (t) => setStPart({ text: t, ok: true }), m, p), (j) =>
          `Berhasil: ${fmt(j.rowCount)} part dari file —${mergeText(j, "part")}${dupText(j)}${skippedText(j)}`
        )
      )}
    />
  );

  const actualCard = (
    <div className="data-card">
      <div className="data-card-head">
        <h4>Actual Sales — otomatis dari web Sales</h4>
        <span className={"data-badge" + (counts.actualSales > 0 ? " ok" : " empty")}>{syncedAt ? "Tersinkron" : "Belum sinkron"}</span>
      </div>
      <div className="hint">Tidak perlu upload. Data diambil otomatis tiap jam dari web Sales — cukup input di web Sales.</div>
      <div className="hint">
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
          <DownloadButton kind="actual" busy={busy} label="⬇ Download Actual" title="Unduh Actual per tahun × customer × product (dengan rincian bulan) untuk dicocokkan dengan web Sales." />
        )}
      </div>
      <div className="danger-zone">
        <div className="danger-zone-title">Jarang dipakai</div>
        <div className="hint">Mengisi ulang Actual semua tahun sejak 2018 (beberapa menit). Hanya perlu setelah perubahan aturan atau koreksi data lama di web Sales.</div>
        <button
          type="button"
          className="slot-btn"
          disabled={busy}
          onClick={() => run(setStSync, () => syncActualSales("all", (t) => setStSync({ text: t, ok: true })), (m) => `Berhasil. ${m}`)}
        >
          ⟳ Sinkron ulang semua tahun
        </button>
      </div>
      {stSync && <div className={"upload-status " + (stSync.ok ? "ok" : "err")}>{stSync.text}</div>}
    </div>
  );

  const TABS: { k: Tab; label: string; ok: boolean | null }[] = [
    { k: "uio", label: "Data UIO", ok: counts.uioUnits > 0 },
    { k: "price", label: "Data Harga", ok: counts.contractPrices + counts.nonContractPrices > 0 },
    { k: "parts", label: "Master Part", ok: counts.parts > 0 },
    { k: "actual", label: "Actual Sales", ok: counts.actualSales > 0 },
    { k: "admin", label: "Kode akses & riwayat", ok: null }
  ];

  return (
    <ListsCtx.Provider value={lists}>
    <div className="modal-scrim" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal upload-modal">
        <div className="upload-head">
          <h3>Upload data</h3>
          {auth && (
            <span className="who">
              {isAdm ? "Admin" : `Cabang ${auth.role === "branch" ? auth.branch : ""}`}
              <button
                type="button"
                className="link-btn"
                disabled={busy}
                onClick={() => {
                  setAuth(null);
                  setUioPending(null);
                  setPend({ contract: null, non_contract: null, parts: null });
                }}
              >
                Keluar
              </button>
            </span>
          )}
          <button className="modal-close" onClick={onClose} disabled={busy} aria-label="Tutup">
            ✕
          </button>
        </div>

        {!auth && (
          <SignIn
            branches={pacBranches}
            auth={auth}
            busy={busy}
            onAuth={(a) => {
              setAuth(a);
              setTab("uio");
            }}
          />
        )}

        {isBranch && uioCard}

        {isAdm && (
          <>
            {missing.length > 0 && (
              <div className="upload-warn">
                ⚠ <b>{missing.join(", ")}</b> belum ada, jadi Market Size belum bisa dihitung.
              </div>
            )}
            <div className="upload-tabs" role="tablist" aria-label="Jenis data">
              {TABS.map((t) => (
                <button key={t.k} type="button" role="tab" aria-selected={tab === t.k} className={tab === t.k ? "on" : ""} disabled={busy} onClick={() => setTab(t.k)}>
                  {t.ok !== null && <span className={"dot" + (t.ok ? " ok" : " empty")} aria-hidden />}
                  {t.label}
                </button>
              ))}
            </div>
            {tab === "uio" && uioCard}
            {tab === "price" && priceCard}
            {tab === "parts" && partsCard}
            {tab === "actual" && actualCard}
            {tab === "admin" && <AdminPanel pin={pin} branches={pacBranches} />}
          </>
        )}
      </div>
    </div>
    </ListsCtx.Provider>
  );
}
