"use client";

import type { DataMeta } from "@/lib/types";
import type { PartWithoutPrice } from "@/lib/calculations";

export default function InfoModal({
  open,
  onClose,
  meta,
  partsWithoutPrice
}: {
  open: boolean;
  onClose: () => void;
  meta: DataMeta;
  partsWithoutPrice: PartWithoutPrice[];
}) {
  if (!open) return null;
  return (
    <div className="modal-scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <button className="modal-close" onClick={onClose}>
          ✕
        </button>
        <h3>Tentang data di dashboard ini</h3>
        <ul>
          <li>
            Product, Model Unit, Part Name/Number, HM/Day, UIO nasional, serta rumus Qty &amp; Amount Market Size
            diambil dari file kalkulator yang terakhir diupload (atau data contoh awal jika belum ada yang upload).
          </li>
          <li>
            Breakdown per Area / Customer Group / Customer Name dihitung proporsional dari distribusi UIO per brand
            pada data customer yang aktif. Akurat hanya jika data customer mencakup seluruh populasi unit.
          </li>
          <li>
            Chart UIO per Product, Market Size per Tahun, dan Market Share per Tahun di halaman Dashboard dihitung
            dari Data UIO (populasi unit per tahun) dan Data Harga yang diupload — dipisah per tahun, tidak dicampur.
          </li>
          <li>
            Setiap upload data baru bersifat menambah/memperbarui (data lama tidak hilang), sehingga histori
            populasi UIO dari waktu ke waktu tetap bisa dilihat trennya.
          </li>
          <li>
            Business Area adalah usulan pengelompokan awal berdasarkan lini produk (Material Handling, Agrikultur,
            Konstruksi, Power &amp; Industrial) — mohon dikonfirmasi.
          </li>
          <li>Semua data disimpan di Supabase dan terlihat oleh siapa pun yang mengakses dashboard ini.</li>
        </ul>
        <h3 style={{ marginTop: 18 }}>Sumber data yang sedang aktif</h3>
        <ul>
          <li>Kalkulator (part &amp; UIO): <b>{meta.kalkulator_filename ?? "data contoh"}</b></li>
          <li>Customer &amp; UIO per brand: <b>{meta.customers_filename ?? "data contoh"}</b></li>
          <li>Actual sales: <b>{meta.actual_sales_filename ?? "data contoh"}</b></li>
          <li>Data UIO (populasi unit): <b>{meta.uio_units_filename ?? "belum ada"}</b></li>
          <li>Data Harga (per Customer Group): <b>{meta.price_list_filename ?? "belum ada"}</b></li>
        </ul>
        <h3 style={{ marginTop: 18 }}>Part Number tanpa harga ({partsWithoutPrice.length})</h3>
        {partsWithoutPrice.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--ink-mute)" }}>
            Semua Part Number di Kalkulator sudah punya harga (dari Data Harga atau pricelist bawaan).
          </p>
        ) : (
          <>
            <p style={{ fontSize: 13, color: "var(--ink-mute)" }}>
              Part Number ini tidak ketemu pasangannya di Data Harga maupun pricelist bawaan — Contract Price-nya
              jadi 0, sehingga tidak menyumbang ke Market Size. Lengkapi di Data Harga kalau seharusnya ada.
            </p>
            <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
              <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", position: "sticky", top: 0, background: "var(--surface-2)" }}>
                    <th style={{ padding: "6px 8px" }}>Product</th>
                    <th style={{ padding: "6px 8px" }}>Model</th>
                    <th style={{ padding: "6px 8px" }}>Part Number</th>
                    <th style={{ padding: "6px 8px" }}>Part Name</th>
                  </tr>
                </thead>
                <tbody>
                  {partsWithoutPrice.map((p, i) => (
                    <tr key={`${p.product}-${p.model}-${p.part_number}-${i}`} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "6px 8px" }}>{p.product}</td>
                      <td style={{ padding: "6px 8px" }}>{p.model}</td>
                      <td style={{ padding: "6px 8px" }}>{p.part_number}</td>
                      <td style={{ padding: "6px 8px" }}>{p.part_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
