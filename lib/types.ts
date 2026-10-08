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
  annual_hm: number;
  uio_qty: number;
  qty_market_size: number;
  contract_price: number;
  amount_market_size: number;
};

export type UioMaster = {
  id?: number;
  product: string;
  model: string;
  hm_day: number;
  uio_qty: number;
};

export type Assumption = {
  product: string;
  workdays_month: number;
  discount: number;
};

/** Urutan tier yang dipakai tim TRAKNUS (dari laporan key account) —
 * dipakai untuk mengurutkan pilihan filter. Customer dengan tier di luar
 * daftar ini tetap tampil (tidak difilter), hanya urutannya di akhir. */
export const CUSTOMER_TIER_OPTIONS = [
  "KA NASIONAL",
  "KA BRANCH PLATINUM",
  "KA BRANCH GOLD",
  "NKA",
  "DEALER",
  "SHN"
] as const;

export type Customer = {
  id?: number;
  no: number | null;
  customer_group: string | null;
  cabang: string | null;
  customer_code: string | null;
  customer_name: string | null;
  pss: string | null;
  /** Klasifikasi key account — lihat CUSTOMER_TIER_OPTIONS. Opsional: null
   * kalau file yang diupload belum punya kolom ini. */
  tier: string | null;
  uio_by_brand: Record<string, number>;
  total_uio: number;
  /** Customer Sector (Plantation, Rental, Mining, dst) — bisa lebih dari satu
   * per customer, jadi array. Dipakai sebagai sumber filter "Sector".
   * Opsional & sengaja TIDAK diisi oleh parseCustomerWorkbook (upload "Cust
   * Data") — diisi lewat SQL import terpisah, jadi re-upload Cust Data tidak
   * menimpanya (supabase upsert hanya meng-update kolom yang ada di payload). */
  customer_sector?: string[];
};

export type ActualSalesRow = {
  id?: number;
  year: number;
  month: string;
  product: string;
  actual_sales: number;
};

export type MonthlyRow = {
  year: number;
  month: string;
  product: string;
  market_size: number;
  actual_sales: number;
};

/** A snapshot of one Quick Calculator computation, saved by the user into
 * the "summary part yang dicek" list on the Calculator tab. Values are
 * frozen at the moment "Tambah ke summary" was clicked — later edits to
 * assumptions/discounts do not change rows already added. */
export type CalcSummaryItem = {
  id: string;
  addedAt: string;
  product: string;
  model: string;
  partName: string;
  partNumber: string | null;
  qtyPerUnit: number;
  pricelist: number;
  freqReplacementHm: number;
  hmDay: number;
  uio: number;
  discount: number;
  annualHm: number;
  qtyMarketSize: number;
  contractPrice: number;
  amountMarketSize: number;
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
 * angka manual di UioMaster — dan untuk chart "UIO per Product". */
export type UioUnit = {
  id?: number;
  year: number | null;
  product: string | null;
  model: string | null;
  customer_group: string | null;
  customer_name: string | null;
  branch: string | null;
  serial_number: string | null;
};

/** Harga per Part Number, opsional beda per Customer Group (kontrak harga
 * khusus). customer_group === "" berarti harga default/nasional. */
export type PriceListEntry = {
  id?: number;
  part_number: string;
  customer_group: string;
  price: number;
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

export type DataMeta = {
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
};

export type DashboardData = {
  parts: Part[];
  uio: UioMaster[];
  assumptions: Assumption[];
  customers: Customer[];
  actualSales: ActualSalesRow[];
  /** Actual Sales per transaksi/part; kosong kalau tabel actual_sales_tx belum diisi. */
  actualSalesTx: ActualSalesTx[];
  uioUnits: UioUnit[];
  priceList: PriceListEntry[];
  meta: DataMeta;
};

export const MONTH_ORDER = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
] as const;

export const CUST_BRAND_MAP: Record<string, string> = {
  MF: "MF", CANYCOM: "CNY", TOYOTA: "TYT", BT: "BT/RAY", RAYMOND: "BT/RAY",
  PERKINS: "PER", GD: "GD/COM", KUBOTA: "KBT", HSC: "HSC"
};
