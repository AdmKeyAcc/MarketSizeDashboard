-- v28: akses upload per cabang, catatan upload, dan kolom Engine Number di Data UIO.
-- Hanya MENAMBAH tabel/kolom/index — tidak mengubah atau menghapus data yang sudah ada.
-- Jalankan sekali di Supabase (database Market Size) → SQL Editor → Run.

-- 1) Kode akses cabang. Isinya hanya HASH kode (kode aslinya tidak pernah disimpan).
--    RLS aktif TANPA policy → tidak bisa dibaca dari browser (anon key); hanya server (service role) yang bisa.
create table if not exists public.branch_access (
  branch      text primary key,          -- kode cabang, huruf besar (mis. PTK)
  code_hash   text not null,             -- scrypt(salt, kode)
  salt        text not null,
  updated_at  timestamptz not null default now()
);
alter table public.branch_access enable row level security;

-- 2) Catatan setiap upload (siapa, cabang mana, file apa, berapa baris).
--    Hanya server yang menulis; boleh dibaca (tanpa data rahasia) untuk ditampilkan di modal Upload.
create table if not exists public.upload_log (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  role        text not null,             -- 'admin' / 'cabang'
  branch      text,                      -- cabang pengupload (role cabang)
  kind        text not null,             -- 'uio' / 'price_contract' / 'price_non_contract' / 'parts'
  mode        text,                      -- 'merge' / 'replace' / 'branch_add'
  filename    text,
  rows_sent   integer,
  rows_saved  integer,
  rows_rejected integer,
  note        text
);
alter table public.upload_log enable row level security;
drop policy if exists "public read upload_log" on public.upload_log;
create policy "public read upload_log" on public.upload_log for select using (true);
create index if not exists upload_log_created_idx on public.upload_log (created_at desc);

-- 3) Engine Number di Data UIO (opsional). Dipakai untuk cek unit dobel selain Product + Serial Number.
alter table public.uio_units add column if not exists engine_number text;
create index if not exists uio_units_engine_idx on public.uio_units (engine_number) where engine_number is not null;
create index if not exists uio_units_branch_idx on public.uio_units (branch);
