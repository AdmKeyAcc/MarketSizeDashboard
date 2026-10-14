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
        
        <div className="upload-slot">
          <h4>1. Data UIO (.xlsx)</h4>
        
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
