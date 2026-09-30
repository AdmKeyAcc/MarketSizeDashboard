"use client";

import type { DataMeta } from "@/lib/types";

export default function InfoModal({
  open,
  onClose,
  meta
}: {
  open: boolean;
  onClose: () => void;
  meta: DataMeta;
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
      </div>
    </div>
  );
}
