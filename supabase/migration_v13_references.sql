-- =====================================================================
-- Migration v13 — Tabel referensi (kamus & pengaturan) yang dikelola admin
-- =====================================================================
-- Jalankan SEKALI di Supabase → SQL Editor. Aman dijalankan ulang
-- (create if not exists + insert ... on conflict do nothing: nilai yang
-- sudah Anda ubah tidak ditimpa).
--
-- Setelah ini, nilai di bawah cukup diubah lewat Table Editor Supabase
-- (tanpa edit kode / deploy ulang). Dashboard membaca tabel ini setiap
-- dibuka; kalau tabel belum ada, dashboard memakai nilai bawaan yang sama.
-- =====================================================================

-- 1) Alias product: kode/nama di Data UIO / Laporan Sales → nama Product di Master Part
create table if not exists public.product_alias (
  alias       text primary key,          -- huruf besar, mis. 'TYT'
  product     text not null,             -- nama kanonik, mis. 'TOYOTA'
  note        text,
  updated_at  timestamptz not null default now()
);

insert into public.product_alias (alias, product, note) values
  ('TYT', 'TOYOTA',    'kode di Data UIO'),
  ('PER', 'PERKINS',   'kode di Data UIO'),
  ('MFT', 'MF',        'kode di Data UIO'),
  ('KBT', 'KUBOTA',    'kode di Data UIO'),
  ('BTF', 'BT',        'kode di Data UIO'),
  ('GDD', 'GD',        'kode di Data UIO'),
  ('CNC', 'CANYCOM',   'kode di Data UIO'),
  ('FGW', 'FG WILSON', 'kode di Data UIO'),
  ('IRN', 'IR',        'kode di Data UIO'),
  ('LBT', 'LINK-BELT', 'kode di Data UIO'),
  ('MASSEY FERGUSON', 'MF', 'nama di Laporan Sales'),
  ('GARDNER DENVER',  'GD', 'nama di Laporan Sales')
on conflict (alias) do nothing;

-- 2) KA Type + urutan tampil
create table if not exists public.ka_types (
  name        text primary key,          -- huruf besar, mis. 'KA NASIONAL'
  sort_order  integer not null default 999,
  updated_at  timestamptz not null default now()
);

insert into public.ka_types (name, sort_order) values
  ('KA NASIONAL', 1),
  ('KA BRANCH PLATINUM', 2),
  ('KA BRANCH GOLD', 3),
  ('NKA', 4),
  ('DEALER', 5),
  ('SHN', 6)
on conflict (name) do nothing;

-- 3) Angka default rumus
create table if not exists public.app_settings (
  key          text primary key,
  value        numeric not null,
  description  text,
  updated_at   timestamptz not null default now()
);

insert into public.app_settings (key, value, description) values
  ('default_hm_day',         8,   'HM/hari kalau Data UIO dan Master Part tidak punya angkanya (maks 24)'),
  ('default_workdays_month', 22,  'Hari kerja/bulan kalau kolom Day/Month di Data UIO kosong'),
  ('default_months_year',    12,  'Bulan operasi/tahun kalau kolom Month/Year di Data UIO kosong'),
  ('non_contract_discount',  0.5, 'Potongan Harga Non Kontrak: 0.5 = harga nett 50% dari harga tertera. Berlaku untuk upload berikutnya.')
on conflict (key) do nothing;

-- 4) RLS: publik hanya boleh membaca (penulisan lewat Supabase dashboard / service role)
alter table public.product_alias enable row level security;
alter table public.ka_types     enable row level security;
alter table public.app_settings enable row level security;

drop policy if exists "public read product_alias" on public.product_alias;
create policy "public read product_alias" on public.product_alias for select using (true);
drop policy if exists "public read ka_types" on public.ka_types;
create policy "public read ka_types" on public.ka_types for select using (true);
drop policy if exists "public read app_settings" on public.app_settings;
create policy "public read app_settings" on public.app_settings for select using (true);

-- ---------------------------------------------------------------------
-- (Opsional) Cek constraint UNIQUE yang dibutuhkan upload (upsert).
-- Jalankan query ini; harus muncul 4 baris. Kalau ada yang hilang,
-- upload terkait akan gagal dengan pesan "no unique or exclusion constraint".
-- ---------------------------------------------------------------------
-- select tablename, indexdef from pg_indexes
-- where schemaname = 'public'
--   and tablename in ('parts', 'uio_units', 'customers', 'price_list')
--   and indexdef ilike '%unique%' and indexname not like '%_pkey';
