"use client";

import { useState } from "react";
import { downloadUioTemplate, downloadPriceTemplate } from "@/lib/downloadTemplates";

type SlotStatus = { text: string; ok: boolean } | null;

async function uploadFile(url: string, file: File): Promise<{ ok: boolean; message: any }> {
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

export default function UploadModal({
  open,
  onClose,
  onUploaded
}: {
  open: boolean;
  onClose: () => void;
  onUploaded: () => Promise<void> | void;
}) {
  const [statusUioUnits, setStatusUioUnits] = useState<SlotStatus>(null);
  const [statusPriceList, setStatusPriceList] = useState<SlotStatus>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function handleUpload(
    e: React.ChangeEvent<HTMLInputElement>,
    url: string,
    setStatus: (s: SlotStatus) => void,
    successMessage: (json: any) => string
  ) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setStatus({ text: "Memproses…", ok: true });
    const result = await uploadFile(url, file);
    if (result.ok) {
      setStatus({ text: successMessage(result.message), ok: true });
      await onUploaded();
    } else {
      setStatus({ text: "Gagal: " + result.message, ok: false });
    }
    setBusy(false);
    e.target.value = "";
  }

  return (
    <div className="modal-scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <button className="modal-close" onClick={onClose}>
          ✕
        </button>
        <h3>Upload data</h3>
        <p className="note">
          Ada 2 jenis data yang bisa diupload — <b>Data UIO</b> (populasi unit) dan <b>Data Harga</b> (harga per Part
          Number) — yang saling terhubung lewat kolom <b>Customer Group</b>. Data disimpan di Supabase, dan setiap
          upload bersifat <b>menambah/memperbarui</b> — data yang sudah ada sebelumnya tidak hilang.
        </p>

        <div className="upload-slot">
          <h4>1. Data UIO — populasi unit (.xlsx)</h4>
          <div className="hint">
            1 baris = 1 unit fisik pada tahun tertentu. Kolom: <b>Tahun, Product, Model, Customer Group, Customer
            Name, Branch (Cabang), Serial Number</b>. Unit dengan serial number yang sama akan <b>diperbarui</b>;
            unit lain (termasuk dari upload tahun/bulan sebelumnya) tetap tersimpan — jadi tren populasi UIO dari
            waktu ke waktu tetap bisa dilihat lewat halaman Dashboard.
          </div>
          <div className="upload-row">
            <input
              type="file"
              className="file-input"
              accept=".xlsx,.xls"
              disabled={busy}
              onChange={(e) =>
                handleUpload(e, "/api/upload/uio-units", setStatusUioUnits, (j) =>
                  `Berhasil: ${j.rowCount} baris unit terbaca (sheet "${j.sheet}").${j.skipped ? ` (${j.skipped} baris dilewati.)` : ""}`
                )
              }
            />
            <button className="link-btn" onClick={downloadUioTemplate}>
              Unduh template
            </button>
          </div>
          {statusUioUnits && <div className={"upload-status " + (statusUioUnits.ok ? "ok" : "err")}>{statusUioUnits.text}</div>}
        </div>

        <div className="upload-slot">
          <h4>2. Data Harga per Part Number (.xlsx)</h4>
          <div className="hint">
            Kolom: <b>Part Number, Customer Group (opsional), Harga</b>. Kosongkan Customer Group untuk harga
            umum/nasional. Kombinasi Part Number + Customer Group yang cocok akan <b>diperbarui</b>; kombinasi baru
            digabung.
          </div>
          <div className="upload-row">
            <input
              type="file"
              className="file-input"
              accept=".xlsx,.xls"
              disabled={busy}
              onChange={(e) =>
                handleUpload(e, "/api/upload/price-list", setStatusPriceList, (j) =>
                  `Berhasil: ${j.rowCount} baris harga terbaca.${j.skipped ? ` (${j.skipped} baris dilewati.)` : ""}`
                )
              }
            />
            <button className="link-btn" onClick={downloadPriceTemplate}>
              Unduh template
            </button>
          </div>
          {statusPriceList && <div className={"upload-status " + (statusPriceList.ok ? "ok" : "err")}>{statusPriceList.text}</div>}
        </div>
      </div>
    </div>
  );
}
