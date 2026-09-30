-- Market Size Dashboard — Supabase schema
-- Run this once in the Supabase SQL editor (or via `supabase db push`) on a
-- fresh project before deploying the app.
--
-- This script is idempotent: it drops each table first (if it exists) and
-- recreates it from scratch, so it's safe to re-run if an earlier attempt
-- partially failed or if a table was created by hand with different columns.
-- Only run this on a fresh project / before you have real data — the drops
-- are destructive. For an existing project with data already in it, use
-- supabase/migration_v2.sql instead (it only adds, never drops).
--
-- Design notes:
--  * All writes happen server-side through Next.js API routes using the
--    service role key, which bypasses Row Level Security entirely. Because
--    of that, no INSERT/UPDATE/DELETE policies are defined below — the
--    tables are effectively read-only from the browser's point of view.
--  * Every upload is now ADDITIVE (upsert on a natural key), not a full
--    replace: uploading a new file merges into what's already there instead
--    of erasing it. Each table's natural key is noted next to it below.

drop table if exists parts cascade;
drop table if exists uio_master cascade;
drop table if exists assumptions cascade;
drop table if exists customers cascade;
drop table if exists actual_sales cascade;
drop table if exists app_meta cascade;
drop table if exists market_size_snapshots cascade;
drop table if exists uio_units cascade;
drop table if exists uio_snapshots cascade;
drop table if exists price_list cascade;

-- ---------------------------------------------------------------------
-- Reference data from the market size calculator template
-- Natural key: (product, model, part_number) — re-uploading the Kalkulator
-- file updates matching parts and adds new ones; it no longer deletes parts
-- missing from the newest file.
-- ---------------------------------------------------------------------
create table parts (
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
-- Rows with a null part_number are never deduped against each other
-- (Postgres treats each NULL as distinct) — they always insert as new.
create unique index if not exists parts_natural_key on parts (product, model, part_number);

create table uio_master (
  id bigint generated always as identity primary key,
  product text,
  model text,
  hm_day numeric,
  uio_qty numeric,
  created_at timestamptz not null default now()
);
create index if not exists uio_master_model_idx on uio_master (model);
create unique index if not exists uio_master_natural_key on uio_master (product, model);

create table assumptions (
  product text primary key,
  workdays_month numeric not null default 22,
  discount numeric not null default 0.5,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Customer / UIO-by-brand data (key account review export)
-- Natural key: (customer_group, customer_name).
-- ---------------------------------------------------------------------
create table customers (
  id bigint generated always as identity primary key,
  no integer,
  customer_group text,
  cabang text,
  customer_code text,
  customer_name text,
  pss text,
  -- Klasifikasi key account (KA Nasional / KA Branch Platinum / KA Branch
  -- Gold / NKA / Dealer / SHN, dst). Kolom opsional: dibaca dari kolom
  -- terakhir sheet "Cust Data" (setelah Total UIO) kalau ada; file lama
  -- tanpa kolom ini tetap jalan dengan tier = null.
  tier text,
  uio_by_brand jsonb not null default '{}'::jsonb,
  total_uio numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customers_group_idx on customers (customer_group);
create index if not exists customers_cabang_idx on customers (cabang);
create index if not exists customers_name_idx on customers (customer_name);
create index if not exists customers_tier_idx on customers (tier);
create unique index if not exists customers_natural_key on customers (customer_group, customer_name);

-- ---------------------------------------------------------------------
-- Actual sales — the only table that already grew incrementally
-- ---------------------------------------------------------------------
create table actual_sales (
  id bigint generated always as identity primary key,
  year integer not null,
  month text not null,
  product text not null,
  actual_sales numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (year, month, product)
);

-- ---------------------------------------------------------------------
-- Histori market size — satu baris ditambahkan otomatis setiap kali
-- upload kalkulator berhasil, supaya nilainya bisa dilihat dari waktu ke
-- waktu (bukan cuma snapshot terakhir seperti tabel `parts`).
-- ---------------------------------------------------------------------
create table market_size_snapshots (
  id bigint generated always as identity primary key,
  captured_at timestamptz not null default now(),
  filename text,
  total_amount_market_size numeric not null default 0,
  by_product jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists market_size_snapshots_captured_at_idx on market_size_snapshots (captured_at);

-- ---------------------------------------------------------------------
-- Data UIO — populasi unit per baris (1 baris = 1 unit fisik), sumber:
-- upload "Data UIO" (mis. sheet "Populasi All Branch"). Ini yang dipakai
-- untuk menghitung UIO di formula Market Size (menggantikan angka UIO
-- manual di uio_master) dan untuk chart "UIO per Product".
--
-- Natural key: dedupe_key. Kalau file punya Serial Number yang valid,
-- dedupe_key = serial number itu (jadi re-upload/duplikat unit yang sama
-- meng-update baris yang sudah ada, bukan menduplikasi). Kalau Serial
-- Number kosong/placeholder ("-", dsb — sering terjadi di data lama),
-- dedupe_key dibuat unik sendiri per baris supaya tidak salah gabung ke
-- unit lain yang kebetulan juga tidak punya serial number.
-- ---------------------------------------------------------------------
create table uio_units (
  id bigint generated always as identity primary key,
  dedupe_key text not null,
  year integer,
  product text,
  model text,
  customer_group text,
  customer_name text,
  branch text,
  serial_number text,
  engine_serial_number text,
  source_filename text,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists uio_units_dedupe_key on uio_units (dedupe_key);
create index if not exists uio_units_year_idx on uio_units (year);
create index if not exists uio_units_product_idx on uio_units (product);
create index if not exists uio_units_customer_group_idx on uio_units (customer_group);

-- Histori: satu baris per upload Data UIO, merekam total unit & breakdown
-- saat itu — supaya "UIO bulan Februari 300, bulan Maret 350" bisa dilihat
-- trennya tanpa harus merekonstruksi dari uio_units setiap saat.
create table uio_snapshots (
  id bigint generated always as identity primary key,
  captured_at timestamptz not null default now(),
  filename text,
  total_units numeric not null default 0,
  by_year_product jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists uio_snapshots_captured_at_idx on uio_snapshots (captured_at);

-- ---------------------------------------------------------------------
-- Data Harga — pricelist per Part Number, opsional beda per Customer
-- Group (kontrak harga khusus). customer_group = '' (string kosong)
-- berarti "harga default/nasional" untuk part itu.
-- Natural key: (part_number, customer_group).
-- ---------------------------------------------------------------------
create table price_list (
  id bigint generated always as identity primary key,
  part_number text not null,
  customer_group text not null default '',
  price numeric not null default 0,
  source_filename text,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists price_list_natural_key on price_list (part_number, customer_group);

-- ---------------------------------------------------------------------
-- Small key/value table so the UI can show "data terakhir diupload: ..."
-- ---------------------------------------------------------------------
create table app_meta (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into app_meta (key, value) values
  ('kalkulator', '{"filename": null, "updated_at": null}'),
  ('customers', '{"filename": null, "updated_at": null}'),
  ('actual_sales', '{"filename": null, "updated_at": null}'),
  ('uio_units', '{"filename": null, "updated_at": null}'),
  ('price_list', '{"filename": null, "updated_at": null}')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Row Level Security — public read-only, no client-side writes
-- ---------------------------------------------------------------------
alter table parts enable row level security;
alter table uio_master enable row level security;
alter table assumptions enable row level security;
alter table customers enable row level security;
alter table actual_sales enable row level security;
alter table app_meta enable row level security;
alter table market_size_snapshots enable row level security;
alter table uio_units enable row level security;
alter table uio_snapshots enable row level security;
alter table price_list enable row level security;

create policy "public read parts" on parts for select using (true);
create policy "public read uio_master" on uio_master for select using (true);
create policy "public read assumptions" on assumptions for select using (true);
create policy "public read customers" on customers for select using (true);
create policy "public read actual_sales" on actual_sales for select using (true);
create policy "public read app_meta" on app_meta for select using (true);
create policy "public read market_size_snapshots" on market_size_snapshots for select using (true);
create policy "public read uio_units" on uio_units for select using (true);
create policy "public read uio_snapshots" on uio_snapshots for select using (true);
create policy "public read price_list" on price_list for select using (true);

-- No insert/update/delete policies are created for the anon/authenticated
-- roles on purpose — all writes go through the service role key in the
-- Next.js API routes (app/api/upload/**), which bypasses RLS.
