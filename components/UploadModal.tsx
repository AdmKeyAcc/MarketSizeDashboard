"use client";

import { useState } from "react";
import {
  downloadUioTemplate,
  downloadContractPriceTemplate,
  downloadNonContractPriceTemplate
} from "@/lib/downloadTemplates";

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
  const [statusContract, setStatusContract] = useState<SlotStatus>(null);
  const [statusNonContract, setStatusNonContract] = useState<SlotStatus>(null);
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
          Ada 3 jenis data yang bisa diupload: <b>Data UIO</b> (populasi unit), <b>Data Harga Kontrak (SCPL)</b>, dan{" "}
          <b>Data Harga Non Kontrak</b>. Data disimpan di Supabase dan setiap upload bersifat <b>menambah/memperbarui</b>{" "}
          — data yang sudah ada sebelumnya tidak hilang. File berformat .xlsx.
        </p>

        <div className="upload-slot">
          <h4>1. Data UIO — populasi unit (.xlsx)</h4>
          <div className="hint">
            1 baris = 1 unit fisik pada tahun tertentu. Kolom (urutan sama dengan tabel Detail UIO di Dashboard): <b>Branch, Pss Name, Cust. Code, Cust. Name,
            Cust. Group, Cust. Type, Product, Model, Serial Number, Year, HM/Day, Day/Month, Month/Year</b>. Hanya
            Product yang wajib terisi. Unit dengan serial number yang sama akan <b>diperbarui</b>;
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
          <h4>2. Data Harga Kontrak — SCPL (.xlsx)</h4>
          <div className="hint">
            Kolom: <b>Cust. Code, Cust. Name, Cust. Group, Cust. Type, Part Number, Harga</b>. Harga di file ini sudah{" "}
            <b>nett</b> — dipakai apa adanya (tidak dipotong lagi). Harga kontrak berlaku per <b>Cust. Group</b>; baris
            tanpa Cust. Group dilewati. Kombinasi Part Number + Cust. Group yang sama akan <b>diperbarui</b>.
          </div>
          <div className="upload-row">
            <input
              type="file"
              className="file-input"
              accept=".xlsx,.xls"
              disabled={busy}
              onChange={(e) =>
                handleUpload(e, "/api/upload/price-contract", setStatusContract, (j) =>
                  `Berhasil: ${j.rowCount} harga kontrak disimpan.${j.duplicates ? ` (${j.duplicates} baris kembar digabung.)` : ""}${j.skipped ? ` (${j.skipped} baris dilewati.)` : ""}`
                )
              }
            />
            <button className="link-btn" onClick={downloadContractPriceTemplate}>
              Unduh template
            </button>
          </div>
          {statusContract && <div className={"upload-status " + (statusContract.ok ? "ok" : "err")}>{statusContract.text}</div>}
        </div>

        <div className="upload-slot">
          <h4>3. Data Harga Non Kontrak (.xlsx)</h4>
          <div className="hint">
            Format kolom <b>sama</b> dengan Data Harga Kontrak: <b>Cust. Code, Cust. Name, Cust. Group, Cust. Type, Part
            Number, Harga</b> (harga tertera/pricelist). Yang dibaca sistem hanya <b>Part Number</b> dan <b>Harga</b>;
            harga otomatis <b>dikurangi 50%</b>, jadi harga yang dipakai &amp; tampil di tabel = 50% dari angka di file.
            Berlaku untuk customer yang tidak punya harga kontrak. Part Number yang sama akan <b>diperbarui</b>.
          </div>
          <div className="upload-row">
            <input
              type="file"
              className="file-input"
              accept=".xlsx,.xls"
              disabled={busy}
              onChange={(e) =>
                handleUpload(e, "/api/upload/price-non-contract", setStatusNonContract, (j) =>
                  `Berhasil: ${j.rowCount} harga non kontrak disimpan (sudah dikurangi 50%).${j.duplicates ? ` (${j.duplicates} baris kembar digabung.)` : ""}${j.skipped ? ` (${j.skipped} baris dilewati.)` : ""}`
                )
              }
            />
            <button className="link-btn" onClick={downloadNonContractPriceTemplate}>
              Unduh template
            </button>
          </div>
          {statusNonContract && <div className={"upload-status " + (statusNonContract.ok ? "ok" : "err")}>{statusNonContract.text}</div>}
        </div>
      </div>
    </div>
  );
}
