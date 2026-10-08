"use client";

import { useState } from "react";
import { 
  downloadUioTemplate,
  downloadPriceTemplate,
  downloadMasterPartTemplate,
  downloadActualSalesTemplate
} from "@/lib/downloadTemplates";
import { parseMasterPartFile, parseActualSalesTxFile, UploadParseError } from "@/lib/parse/uploadClient";

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

const CHUNK = 3000;

async function postJson(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let json: { error?: string } = {};
  try {
    json = await res.json();
  } catch {
    /* respons bukan JSON */
  }
  if (!res.ok) throw new Error(json.error || `Gagal menyimpan (kode ${res.status}).`);
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
  const [statusMasterPart, setStatusMasterPart] = useState<SlotStatus>(null);
  const [statusActual, setStatusActual] = useState<SlotStatus>(null);
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

  async function handleMasterPart(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const input = e.target;
    if (!file) return;
    setBusy(true);
    setStatusMasterPart({ text: "Membaca file…", ok: true });
    try {
      const parsed = await parseMasterPartFile(file);
      for (let i = 0; i < parsed.rows.length; i += CHUNK) {
        setStatusMasterPart({
          text: `Menyimpan… ${Math.min(i + CHUNK, parsed.rows.length).toLocaleString("id-ID")} / ${parsed.rows.length.toLocaleString("id-ID")} baris`,
          ok: true
        });
        await postJson("/api/upload/master-part", {
          action: "rows",
          rows: parsed.rows.slice(i, i + CHUNK),
          hasHmDay: parsed.hasHmDay,
          hasComponent: parsed.hasComponent
        });
      }
      await postJson("/api/upload/master-part", { action: "finish", filename: file.name, total: parsed.rows.length });
      const notes = [
        parsed.skipped ? `${parsed.skipped.toLocaleString("id-ID")} baris dilewati (data wajib kosong atau tidak valid)` : "",
        parsed.duplicates ? `${parsed.duplicates.toLocaleString("id-ID")} baris kembar digabung` : ""
      ].filter(Boolean);
      setStatusMasterPart({
        text: `Berhasil: ${parsed.rows.length.toLocaleString("id-ID")} part disimpan.${notes.length ? " (" + notes.join("; ") + ".)" : ""}`,
        ok: true
      });
      await onUploaded();
    } catch (err) {
      const msg = err instanceof UploadParseError || err instanceof Error ? err.message : "Gagal memproses file.";
      setStatusMasterPart({ text: "Gagal: " + msg, ok: false });
    }
    setBusy(false);
    input.value = "";
  }

  async function handleActualSales(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const input = e.target;
    if (!file) return;
    setBusy(true);
    setStatusActual({ text: "Membaca file…", ok: true });
    try {
      const parsed = await parseActualSalesTxFile(file);
      setStatusActual({ text: "Menyiapkan periode…", ok: true });
      await postJson("/api/upload/actual-sales-tx", { action: "start", periods: parsed.periods });
      for (let i = 0; i < parsed.rows.length; i += CHUNK) {
        setStatusActual({
          text: `Menyimpan… ${Math.min(i + CHUNK, parsed.rows.length).toLocaleString("id-ID")} / ${parsed.rows.length.toLocaleString("id-ID")} baris`,
          ok: true
        });
        await postJson("/api/upload/actual-sales-tx", {
          action: "rows",
          rows: parsed.rows.slice(i, i + CHUNK),
          filename: file.name
        });
      }
      await postJson("/api/upload/actual-sales-tx", { action: "finish", filename: file.name, total: parsed.rows.length });
      setStatusActual({
        text: `Berhasil: ${parsed.rows.length.toLocaleString("id-ID")} transaksi untuk ${parsed.periods.length} periode (bulan-tahun) disimpan.${
          parsed.skipped ? ` (${parsed.skipped.toLocaleString("id-ID")} baris dilewati.)` : ""
        }`,
        ok: true
      });
      await onUploaded();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Gagal memproses file.";
      setStatusActual({
        text: "Gagal: " + msg + " Upload ulang file yang sama aman dilakukan — data periode itu akan diganti, bukan digandakan.",
        ok: false
      });
    }
    setBusy(false);
    input.value = "";
  }

  return (
    <div className="modal-scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <button className="modal-close" onClick={onClose}>
          ✕
        </button>
        <h3>Upload data</h3>
        <p className="note">
          Ada 4 jenis data yang bisa diupload: <b>Data UIO</b> (populasi unit), <b>Data Harga</b> (harga per Part
          Number), <b>Master Part</b> (qty per unit &amp; frekuensi ganti per part), dan <b>Actual Sales</b> (penjualan
          per transaksi). Keempatnya saling terhubung lewat kolom <b>Product</b>, <b>Model Unit</b>,{" "}
          <b>Part Number</b>, dan <b>Customer Group</b>. Data disimpan di Supabase dan setiap upload bersifat{" "}
          <b>menambah/memperbarui</b> — data yang sudah ada sebelumnya tidak hilang. File boleh .xlsx atau .csv.
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

        <div className="upload-slot">
          <h4>3. Master Part — qty per unit &amp; frekuensi ganti (.xlsx / .csv)</h4>
          <div className="hint">
            1 baris = 1 part untuk 1 model unit. Kolom wajib: <b>Product, Model Unit, Part Number, Qty per Unit,
            Frekuensi Ganti (HM)</b>. Kolom lain: <b>Part Name, Pricelist (Rp)</b> (dipakai kalau part tidak ada di
            Data Harga), <b>HM per Hari</b> (kosong/tidak ada = 8), <b>Komponen</b>. Part yang sama (Product + Model
            + Part Number) <b>diperbarui</b>, part baru ditambahkan, part lain tidak dihapus. Isi Product dengan nama
            yang sama seperti di Data UIO (mis. TOYOTA, PERKINS, MF) dan Model Unit sama persis dengan Data UIO.
          </div>
          <div className="upload-row">
            <input type="file" className="file-input" accept=".xlsx,.xls,.csv" disabled={busy} onChange={handleMasterPart} />
            <button className="link-btn" onClick={downloadMasterPartTemplate}>
              Unduh template
            </button>
          </div>
          {statusMasterPart && <div className={"upload-status " + (statusMasterPart.ok ? "ok" : "err")}>{statusMasterPart.text}</div>}
        </div>

        <div className="upload-slot">
          <h4>4. Actual Sales — penjualan per transaksi (.xlsx / .csv)</h4>
          <div className="hint">
            1 baris = 1 penjualan part ke 1 customer pada 1 bulan. Kolom wajib: <b>Tahun, Bulan, Product, Part
            Number, Qty, Amount (Rp)</b>. Kolom lain: <b>Customer Group, Customer Name</b> (supaya filter Area/Tier/Customer
            bekerja), <b>Model Unit, Part Name</b>. Bulan boleh nama (Januari) atau angka (1–12). Upload ulang bulan
            yang sama akan <b>mengganti</b> data bulan itu (tidak digandakan); bulan lain tidak tersentuh, jadi aman
            diupload bulanan.
          </div>
          <div className="upload-row">
            <input type="file" className="file-input" accept=".xlsx,.xls,.csv" disabled={busy} onChange={handleActualSales} />
            <button className="link-btn" onClick={downloadActualSalesTemplate}>
              Unduh template
            </button>
          </div>
          {statusActual && <div className={"upload-status " + (statusActual.ok ? "ok" : "err")}>{statusActual.text}</div>}
        </div>
      </div>
    </div>
  );
}
