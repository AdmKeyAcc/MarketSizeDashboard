import { DEFAULT_REFERENCES, type References } from "@/lib/references";
export type Part = {
  id?: number;
  product: string;
  model: string;
  component: string | null;
  part_name: string;
  part_number: string | null;
  old_part_number: string | null;
  qty_per_unit: number;
  pricelist: number;
  freq_replacement_hm: number;
  hm_day: number;
};


/** Urutan tier yang dipakai tim TRAKNUS (dari laporan key account) —
 * dipakai untuk mengurutkan pilihan filter. Customer dengan tier di luar
 * daftar ini tetap tampil (tidak difilter), hanya urutannya di akhir. */
export const CUSTOMER_TIER_OPTIONS = DEFAULT_REFERENCES.kaTypes;

export type Customer = {
  id?: number;
  customer_group: string | null;
  cabang: string | null;
  customer_code: string | null;
  customer_name: string | null;
  pss: string | null;
  /** Klasifikasi key account — lihat CUSTOMER_TIER_OPTIONS. Opsional: null
   * kalau file yang diupload belum punya kolom ini. */
  tier: string | null;
};

export type ActualSalesRow = {
  id?: number;
  year: number;
  month: string;
  product: string;
  actual_sales: number;
};


/** A snapshot of one Quick Calculator computation, saved by the user into
 * the "summary part yang dicek" list on the Calculator tab. Values are
 * frozen at the moment "Tambah ke summary" was clicked — later edits to
 * inputs do not change rows already added. */
export type CalcSummaryItem = {
  id: string;
  addedAt: string;
  product: string;
  model: string;
  partName: string;
  partNumber: string | null;
  qtyPerUnit: number;
  freqReplacementHm: number;
  /** Rata-rata per unit yang dipakai (otomatis dari Data UIO atau diisi manual). */
  hmDay: number;
  dayMonth?: number;
  monthYear?: number;
  uio: number;
  /** Jumlah customer yang dihitung (0 = rumus sederhana / tidak ada unit). */
  customers?: number;
  /** Annual HM rata-rata per unit. */
  annualHm: number;
  qtyMarketSize: number;
  /** Harga per pcs yang dipakai (rata-rata tertimbang kalau harga beda per customer group). */
  contractPrice: number;
  amountMarketSize: number;
  /** Periode (mis. "setahun", "Maret", "3 bulan") dan Market Size / Qty periode itu. */
  period?: string;
  amountPeriod?: number;
  qtyPeriod?: number;
  /** Konteks perhitungan (opsional — item lama di localStorage tidak punya). */
  year?: number | null;
  customerGroup?: string;
  customerName?: string;
  priceSource?: string;
  /** Kolom lama (sebelum update-14) — tidak dipakai lagi. */
  pricelist?: number;
  discount?: number;
};

/** Satu baris histori: direkam otomatis setiap kali upload kalkulator
 * berhasil, supaya total market size bisa dilihat dari waktu ke waktu. */
export type MarketSizeSnapshot = {
  id?: number;
  captured_at: string;
  filename: string | null;
  total_amount_market_size: number;
  by_product: Record<string, number>;
};

/** Satu baris = satu unit fisik yang terkonfirmasi beroperasi (populasi
 * UIO), sumber dari upload "Data UIO" (mis. sheet "Populasi All Branch").
 * Ini yang dipakai untuk menghitung UIO di formula Market Size — bukan lagi
 * chart "UIO per Product". */
export type UioUnit = {
  id?: number;
  /** Year Inv — tahun invoice/pembelian unit. */
  year: number | null;
  /** Month Inv — bulan invoice/pembelian (1–12); null = dianggap beroperasi setahun penuh di tahun belinya. */
  month_inv?: number | null;
  product: string | null;
  model: string | null;
  customer_group: string | null;
  customer_name: string | null;
  branch: string | null;
  serial_number: string | null;
  pss_name?: string | null;
  customer_code?: string | null;
  customer_type?: string | null;
  hm_day?: number | null;
  day_month?: number | null;
  month_year?: number | null;
};

/** Harga per Part Number, opsional beda per Customer Group (kontrak harga
 * khusus). customer_group === "" berarti harga default/nasional. */
export type PriceListEntry = {
  id?: number;
  part_number: string;
  customer_group: string;
  price: number;
  /** 'contract' = SCPL (nett), 'non_contract' = umum (tertera - 50%). */
  price_type?: "contract" | "non_contract";
  list_price?: number | null;
};

/** Actual Sales per transaksi/part (tabel actual_sales_tx). 1 baris = penjualan
 * satu part ke satu customer pada satu bulan. */
export type ActualSalesTx = {
  year: number;
  month: string;
  customer_group: string | null;
  customer_name: string | null;
  product: string | null;
  model: string | null;
  part_number: string | null;
  qty: number;
  amount: number;
};

/** Actual Sales tahunan per customer (tabel actual_sales_year), dari laporan 3 tingkat
 * KA Type -> Customer Group -> Customer. Tanpa bulan / product / part. */
export type ActualSalesYear = {
  year: number;
  ka_type: string | null;
  /** Product (canonical) kalau laporan yang diupload per Product; null untuk laporan lama tanpa Product. */
  product?: string | null;
  customer_group: string;
  customer_name: string;
  amount: number;
  /** Rincian Jan–Des (12 angka) kalau tersedia (hasil sinkron web Sales); null untuk upload laporan tahunan. */
  amount_by_month?: number[] | null;
};

export type DataMeta = {
  /** Data tahun terbaru di Actual Sales tahunan baru sampai bulan ini (null = setahun penuh). */
  actual_year_ytd_year?: number | null;
  actual_year_ytd_month?: string | null;
  actual_year_filename?: string | null;
  /** Waktu sinkron terakhir dari web Sales (null = data dari upload file). */
  actual_year_synced_at?: string | null;
  /** Tanggal posting terakhir di data Sales saat sinkron. */
  actual_year_max_date?: string | null;
  /** Jumlah baris Actual per part/bulan di database (isinya tidak dimuat ke dashboard). */
  actual_tx_count?: number;
  kalkulator_updated_at: string | null;
  kalkulator_filename: string | null;
  customers_updated_at: string | null;
  customers_filename: string | null;
  actual_sales_updated_at: string | null;
  actual_sales_filename: string | null;
  uio_units_updated_at: string | null;
  uio_units_filename: string | null;
  price_list_updated_at: string | null;
  price_list_filename: string | null;
  /** Upload terakhir per jenis harga (null = belum pernah / data lama sebelum update-11). */
  price_contract_filename?: string | null;
  price_contract_updated_at?: string | null;
  price_non_contract_filename?: string | null;
  price_non_contract_updated_at?: string | null;
  /** Cara upload terakhir: replace (ganti semua) / merge (tambah / perbarui). */
  uio_units_mode?: "replace" | "merge" | null;
  kalkulator_mode?: "replace" | "merge" | null;
  price_contract_mode?: "replace" | "merge" | null;
  price_non_contract_mode?: "replace" | "merge" | null;
  /** Jenis harga upload terakhir di key lama "price_list" (contract / non_contract). */
  price_list_type?: string | null;
};

export type DashboardData = {
  parts: Part[];
  customers: Customer[];
  actualSales: ActualSalesRow[];
  /** Actual Sales per transaksi/part; kosong kalau tabel actual_sales_tx belum diisi. */
  actualSalesTx: ActualSalesTx[];
  /** Actual Sales tahunan per customer; kosong kalau belum di-upload. */
  actualSalesYear: ActualSalesYear[];
  uioUnits: UioUnit[];
  priceList: PriceListEntry[];
  meta: DataMeta;
  /** Kamus & pengaturan dari tabel product_alias, ka_types, app_settings (lihat lib/references.ts). */
  references: References;
};

export const MONTH_ORDER = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
] as const;

