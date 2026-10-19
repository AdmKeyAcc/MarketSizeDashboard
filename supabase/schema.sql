-- Market Size Dashboard — Supabase schema (kondisi TERBARU)
-- Setara dengan: schema lama + migration v2 s/d v10 + migration v11 STEP 1 & 2.
--
-- Cara pakai:
--  * Project BARU / kosong : jalankan seluruh file ini sekali.
--  * Project yang SUDAH ada data: JANGAN dijalankan ulang untuk "menyamakan" —
--    file ini hanya memakai CREATE ... IF NOT EXISTS, jadi tidak menghapus apa pun,
--    tapi struktur tabel lama tidak otomatis berubah. Untuk database yang sudah jalan,
--    pakai file migration_v*.sql sesuai urutan.
--
-- Catatan desain:
--  * Semua penulisan data lewat API Next.js (app/api/**) dengan service role key,
--    yang melewati RLS. Karena itu hanya ada policy SELECT publik di bawah.
--  * Upload bersifat ADDITIVE (upsert pada natural key), bukan ganti total.
--  * Tidak ada FOREIGN KEY. Tabel dihubungkan oleh aplikasi lewat kunci logis:
--      - Customer : UPPER(TRIM(customer_group)) || '|' || UPPER(TRIM(customer_name))
--                   (customers  <->  uio_units  <->  actual_sales_tx)
--      - Part     : part_number   (parts <-> price_list <-> actual_sales_tx)
--      - Unit     : product + model (model dinormalisasi: tanpa spasi/tanda hubung)
--    Lihat supabase/check_data_consistency.sql untuk memeriksa data yang tidak nyambung.

-- ---------------------------------------------------------------------
-- parts — master part & asumsi pemakaian
-- Natural key: (product, model, part_number)
-- Kolom hasil hitung (annual_hm, qty_market_size, contract_price, amount_market_size)
-- tidak dibaca aplikasi lagi (dihitung ulang dari rumus); boleh di-drop (v11 STEP 3).
-- ---------------------------------------------------------------------
create table if not exists parts (
  id bigint generated always as identity primary key,
  product text not null,
  model text not null,
  component text,
  part_name text not null,
  part_number text,
  old_part_number text,
  qty_per_unit numeric not null default 0,
  pricelist numeric not null default 0,
  freq_replacement_hm numeric not null default 0,
  hm_day numeric not null default 0,
  annual_hm numeric not null default 0,
  uio_qty numeric not null default 0,
  qty_market_size numeric not null default 0,
  contract_price numeric not null default 0,
  amount_market_size numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists parts_product_idx on parts (product);
create index if not exists parts_model_idx on parts (model);
create unique index if not exists parts_natural_key on parts (product, model, part_number);

-- ---------------------------------------------------------------------
-- uio_master — default HM/Day & UIO per model (fallback kalau Data UIO kosong).
-- Masih dibaca aplikasi (fetchDashboardDataShared), walau isinya boleh kosong.
-- ---------------------------------------------------------------------
create table if not exists uio_master (
  id bigint generated always as identity primary key,
  product text,
  model text,
  hm_day numeric,
  uio_qty numeric,
  created_at timestamptz not null default now()
);
create index if not exists uio_master_model_idx on uio_master (model);
create unique index if not exists uio_master_natural_key on uio_master (product, model);

-- ---------------------------------------------------------------------
-- assumptions — hari kerja per bulan & diskon, per product
-- ---------------------------------------------------------------------
create table if not exists assumptions (
  product text primary key,
  workdays_month numeric not null default 22,
  discount numeric not null default 0,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- customers — master customer (upload "Cust Data")
-- Natural key: (customer_group, customer_name)
-- tier = KA Tier (DEALER, KA BRANCH GOLD/PLATINUM, KA NASIONAL, NKA, SHN)
-- customer_sector diisi lewat SQL import (bukan upload Cust Data).
-- (business_area sudah dihapus — v11 STEP 1.)
-- ---------------------------------------------------------------------
create table if not exists customers (
  id bigint generated always as identity primary key,
  no integer,
  customer_group text,
  cabang text,
  customer_code text,
  customer_name text,
  pss text,
  tier text,
  uio_by_brand jsonb not null default '{}'::jsonb,
  total_uio numeric not null default 0,
  customer_sector text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customers_group_idx on customers (customer_group);
create index if not exists customers_cabang_idx on customers (cabang);
create index if not exists customers_name_idx on customers (customer_name);
create index if not exists customers_tier_idx on customers (tier);
create index if not exists customers_customer_sector_idx on customers using gin (customer_sector);
create unique index if not exists customers_natural_key on customers (customer_group, customer_name);

-- ---------------------------------------------------------------------
-- uio_units — populasi unit (1 baris = 1 unit fisik), upload "Data UIO"
-- Natural key: dedupe_key (serial number; kalau kosong dibuat unik per baris)
-- Sumber perhitungan UIO di rumus market size.
-- ---------------------------------------------------------------------
create table if not exists uio_units (
  id bigint generated always as identity primary key,
  dedupe_key text not null,
  year integer,
  product text,
  model text,
  customer_group text,
  customer_name text,
  customer_code text,
  customer_type text,
  branch text,
  pss_name text,
  serial_number text,
  hm_day numeric,
  day_month numeric,
  month_year numeric,
  source_filename text,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists uio_units_dedupe_key on uio_units (dedupe_key);
create index if not exists uio_units_year_idx on uio_units (year);
create index if not exists uio_units_product_idx on uio_units (product);
create index if not exists uio_units_customer_group_idx on uio_units (customer_group);

-- ---------------------------------------------------------------------
-- price_list — harga per Part Number
-- Natural key: (part_number, customer_group)
--   customer_group = ''  -> harga umum (non kontrak)
--   customer_group <> '' -> harga khusus customer group (kontrak / SCPL)
-- price_type: 'contract'     = harga nett apa adanya
--             'non_contract' = list_price x 0.5 (sudah dikurangi 50% saat upload)
-- ---------------------------------------------------------------------
create table if not exists price_list (
  id bigint generated always as identity primary key,
  part_number text not null,
  customer_group text not null default '',
  price numeric not null default 0,
  price_type text not null default 'non_contract',
  list_price numeric,
  customer_code text,
  customer_name text,
  customer_type text,
  source_filename text,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists price_list_natural_key on price_list (part_number, customer_group);

-- ---------------------------------------------------------------------
-- actual_sales_tx — transaksi penjualan aktual (upload "Actual Sales")
-- ---------------------------------------------------------------------
create table if not exists actual_sales_tx (
  id bigint generated always as identity primary key,
  year integer not null,
  month text not null,
  customer_group text,
  customer_name text,
  product text not null,
  model text,
  part_number text,
  part_name text,
  qty numeric not null default 0,
  amount numeric not null default 0,
  source_filename text,
  uploaded_at timestamptz not null default now()
);
create index if not exists actual_sales_tx_year_idx on actual_sales_tx (year, month);
create index if not exists actual_sales_tx_product_idx on actual_sales_tx (product);
create index if not exists actual_sales_tx_customer_idx on actual_sales_tx (customer_group, customer_name);
create index if not exists actual_sales_tx_part_idx on actual_sales_tx (part_number);

-- ---------------------------------------------------------------------
-- actual_sales_year — Actual Sales TAHUNAN per customer (upload "Laporan Sales")
-- Laporan 3 tingkat KA Type > Customer Group > Customer, satu kolom nilai per tahun.
-- Upload mengganti seluruh isi tabel. (migration v12)
-- ---------------------------------------------------------------------
create table if not exists actual_sales_year (
  id bigint generated always as identity primary key,
  year integer not null,
  ka_type text,
  customer_group text not null default '',
  customer_name text not null default '',
  amount numeric not null default 0,
  source_filename text,
  uploaded_at timestamptz not null default now()
);
create index if not exists actual_sales_year_year_idx on actual_sales_year (year);
create index if not exists actual_sales_year_group_idx on actual_sales_year (customer_group);
create index if not exists actual_sales_year_ka_idx on actual_sales_year (ka_type);

-- ---------------------------------------------------------------------
-- actual_sales — tabel LAMA (agregat per bulan/product). Masih dibaca aplikasi
-- (fetchDashboardDataShared) tapi digantikan actual_sales_tx; boleh kosong.
-- ---------------------------------------------------------------------
create table if not exists actual_sales (
  id bigint generated always as identity primary key,
  year integer not null,
  month text not null,
  product text not null,
  actual_sales numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (year, month, product)
);

-- ---------------------------------------------------------------------
-- app_meta — info "data terakhir diupload"
-- ---------------------------------------------------------------------
create table if not exists app_meta (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into app_meta (key, value) values
  ('kalkulator', '{"filename": null, "updated_at": null}'),
  ('customers', '{"filename": null, "updated_at": null}'),
  ('actual_sales', '{"filename": null, "updated_at": null}'),
  ('uio_units', '{"filename": null, "updated_at": null}'),
  ('price_list', '{"filename": null, "updated_at": null}'),
  ('actual_sales_year', '{"filename": null, "updated_at": null, "ytd_year": null, "ytd_month": null}')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Row Level Security — baca publik, tanpa penulisan dari browser
-- ---------------------------------------------------------------------
alter table parts enable row level security;
alter table uio_master enable row level security;
alter table assumptions enable row level security;
alter table customers enable row level security;
alter table uio_units enable row level security;
alter table price_list enable row level security;
alter table actual_sales_tx enable row level security;
alter table actual_sales enable row level security;
alter table actual_sales_year enable row level security;
alter table app_meta enable row level security;

drop policy if exists "public read parts" on parts;
drop policy if exists "public read uio_master" on uio_master;
drop policy if exists "public read assumptions" on assumptions;
drop policy if exists "public read customers" on customers;
drop policy if exists "public read uio_units" on uio_units;
drop policy if exists "public read price_list" on price_list;
drop policy if exists "public read actual_sales_tx" on actual_sales_tx;
drop policy if exists "public read actual_sales" on actual_sales;
drop policy if exists "public read actual_sales_year" on actual_sales_year;
drop policy if exists "public read app_meta" on app_meta;

create policy "public read parts" on parts for select using (true);
create policy "public read uio_master" on uio_master for select using (true);
create policy "public read assumptions" on assumptions for select using (true);
create policy "public read customers" on customers for select using (true);
create policy "public read uio_units" on uio_units for select using (true);
create policy "public read price_list" on price_list for select using (true);
create policy "public read actual_sales_tx" on actual_sales_tx for select using (true);
create policy "public read actual_sales" on actual_sales for select using (true);
create policy "public read actual_sales_year" on actual_sales_year for select using (true);
create policy "public read app_meta" on app_meta for select using (true);
