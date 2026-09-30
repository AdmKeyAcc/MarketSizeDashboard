-- Migration v2: upload jadi additive (upsert) + Data UIO + Data Harga
-- ---------------------------------------------------------------------
-- Aman dijalankan di project Supabase yang SUDAH punya data — cuma
-- menambah kolom/tabel/index, tidak menghapus apa pun. Jalankan sekali di
-- SQL Editor. (Kalau kamu sudah pernah jalankan migration_tier_and_snapshots.sql
-- dari revisi sebelumnya, migration ini aman dijalankan lagi setelahnya —
-- semua pakai IF NOT EXISTS.)

-- 1) Tier di customers (kalau belum ada dari migrasi sebelumnya)
alter table customers add column if not exists tier text;
create index if not exists customers_tier_idx on customers (tier);

-- 2) updated_at di parts & customers (dipakai upsert)
alter table parts add column if not exists updated_at timestamptz not null default now();
alter table customers add column if not exists updated_at timestamptz not null default now();

-- 3) Natural key supaya upload berikutnya UPSERT, bukan replace-all.
--    Kalau ada baris duplikat pada key ini dari sebelumnya (dari mode
--    replace-all yang lama, seharusnya tidak ada duplikat), buat unique
--    index akan gagal — hubungi kalau itu terjadi.
create unique index if not exists parts_natural_key on parts (product, model, part_number);
create unique index if not exists uio_master_natural_key on uio_master (product, model);
create unique index if not exists customers_natural_key on customers (customer_group, customer_name);

-- 4) market_size_snapshots (kalau belum ada dari migrasi sebelumnya)
create table if not exists market_size_snapshots (
  id bigint generated always as identity primary key,
  captured_at timestamptz not null default now(),
  filename text,
  total_amount_market_size numeric not null default 0,
  by_product jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists market_size_snapshots_captured_at_idx on market_size_snapshots (captured_at);

-- 5) Data UIO (populasi unit per baris) + histori snapshot-nya
create table if not exists uio_units (
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

create table if not exists uio_snapshots (
  id bigint generated always as identity primary key,
  captured_at timestamptz not null default now(),
  filename text,
  total_units numeric not null default 0,
  by_year_product jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists uio_snapshots_captured_at_idx on uio_snapshots (captured_at);

-- 6) Data Harga (pricelist per part number x customer group)
create table if not exists price_list (
  id bigint generated always as identity primary key,
  part_number text not null,
  customer_group text not null default '',
  price numeric not null default 0,
  source_filename text,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists price_list_natural_key on price_list (part_number, customer_group);

-- 7) RLS untuk 3 tabel baru
alter table market_size_snapshots enable row level security;
alter table uio_units enable row level security;
alter table uio_snapshots enable row level security;
alter table price_list enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'market_size_snapshots' and policyname = 'public read market_size_snapshots') then
    create policy "public read market_size_snapshots" on market_size_snapshots for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'uio_units' and policyname = 'public read uio_units') then
    create policy "public read uio_units" on uio_units for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'uio_snapshots' and policyname = 'public read uio_snapshots') then
    create policy "public read uio_snapshots" on uio_snapshots for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'price_list' and policyname = 'public read price_list') then
    create policy "public read price_list" on price_list for select using (true);
  end if;
end $$;

-- 8) app_meta rows baru
insert into app_meta (key, value) values
  ('uio_units', '{"filename": null, "updated_at": null}'),
  ('price_list', '{"filename": null, "updated_at": null}')
on conflict (key) do nothing;
