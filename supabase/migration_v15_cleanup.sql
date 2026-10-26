-- =====================================================================
-- Migration v15 — Hapus tabel yang sudah tidak dipakai
-- DIJALANKAN DI SUPABASE **MARKET SIZE** (database Sales tidak disentuh)
-- =====================================================================
-- Jalankan per langkah, berurutan. Tidak memakai CASCADE: kalau ternyata
-- masih ada yang bergantung pada sebuah tabel, perintahnya GAGAL (tidak ada
-- yang ikut terhapus diam-diam) — kirim pesan errornya untuk dicek.
-- =====================================================================


-- ---------------------------------------------------------------------
-- LANGKAH 0 — Cek isi dulu (hanya membaca)
-- ---------------------------------------------------------------------
select 'bak_parts'            as tabel, count(*) as baris from public.bak_parts
union all select 'bak_customers',        count(*) from public.bak_customers
union all select 'bak_uio_units',        count(*) from public.bak_uio_units
union all select 'bak_price_list',       count(*) from public.bak_price_list
union all select 'bak_actual_sales_tx',  count(*) from public.bak_actual_sales_tx
union all select 'parts_zero_backup',    count(*) from public.parts_zero_backup
union all select 'uio_master',           count(*) from public.uio_master
union all select 'actual_sales',         count(*) from public.actual_sales;
-- Kalau ada tabel backup yang isinya masih ingin disimpan: buka tabelnya di
-- Table Editor → Export → CSV sebelum lanjut.


-- ---------------------------------------------------------------------
-- LANGKAH 1 — Tabel backup (tidak dipakai kode sama sekali; aman kapan saja)
-- ---------------------------------------------------------------------
begin;
drop table if exists public.bak_parts;
drop table if exists public.bak_customers;
drop table if exists public.bak_uio_units;
drop table if exists public.bak_price_list;
drop table if exists public.bak_actual_sales_tx;
drop table if exists public.parts_zero_backup;
commit;


-- ---------------------------------------------------------------------
-- LANGKAH 2 — Tabel lama yang sudah digantikan
--   uio_master   → digantikan uio_units (Data UIO per unit)
--   actual_sales → digantikan actual_sales_year + actual_sales_tx (sinkron web Sales)
-- JALANKAN SETELAH kode terbaru ter-deploy di Vercel (versi lama dashboard
-- masih membaca kedua tabel ini dan akan error kalau tabelnya hilang).
-- ---------------------------------------------------------------------
begin;
drop table if exists public.uio_master;
drop table if exists public.actual_sales;
-- sisa migration lama, kalau pernah dibuat
drop table if exists public.market_size_snapshots;
drop table if exists public.uio_snapshots;
commit;


-- ---------------------------------------------------------------------
-- HASIL AKHIR — tabel yang tersisa & fungsinya
-- ---------------------------------------------------------------------
--   parts                    Master Part (upload)
--   uio_units                Data UIO (upload)
--   price_list               Harga Kontrak & Non Kontrak (upload)
--   customers                Master Customer (nama/KA/cabang untuk pencocokan)
--   assumptions              Hari kerja per Product (cadangan kalau Day/Month UIO kosong)
--   actual_sales_year        Actual per customer × tahun (sinkron web Sales)
--   actual_sales_tx          Actual per part × bulan (sinkron web Sales)
--   actual_branch_exclusions Cabang yang tidak dihitung (JKT, SBY, SMG, BDG)
--   product_alias, ka_types, app_settings   Kamus & pengaturan
--   app_meta                 Catatan upload/sinkron terakhir
--
-- Cek:
-- select table_name from information_schema.tables where table_schema = 'public' order by 1;
