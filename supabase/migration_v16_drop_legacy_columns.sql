-- =====================================================================
-- Migration v16 — Buang kolom sisa versi lama
-- DIJALANKAN DI SUPABASE **MARKET SIZE**, SETELAH kode terbaru ter-deploy
-- (kode lama masih membaca sebagian kolom ini).
-- =====================================================================
-- Isi tabel (baris) TIDAK dihapus — hanya kolom yang sudah tidak dipakai.
-- Aman dijalankan ulang (drop column if exists).
-- =====================================================================


-- ---------------------------------------------------------------------
-- LANGKAH 0 — Cek constraint UNIQUE yang dibutuhkan upload (hanya membaca)
-- Harus ada: parts(product, model, part_number), price_list(part_number,
-- customer_group), uio_units(dedupe_key). Kalau ada yang hilang, kirim hasilnya.
-- ---------------------------------------------------------------------
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and indexdef ilike '%unique%'
  and indexname not like '%_pkey'
order by tablename;


-- ---------------------------------------------------------------------
-- LANGKAH 1 — Buang kolom
-- ---------------------------------------------------------------------
begin;

-- parts: hasil hitungan Excel lama (dashboard menghitung sendiri dari Data UIO + harga)
alter table public.parts
  drop column if exists annual_hm,
  drop column if exists uio_qty,
  drop column if exists qty_market_size,
  drop column if exists contract_price,
  drop column if exists amount_market_size;

-- customers: sisa template customer lama & sektor (tidak dipakai)
alter table public.customers
  drop column if exists no,
  drop column if exists uio_by_brand,
  drop column if exists total_uio,
  drop column if exists customer_sector;

-- assumptions: diskon per product (diganti app_settings.non_contract_discount)
alter table public.assumptions
  drop column if exists discount;

commit;


-- ---------------------------------------------------------------------
-- Cek hasil
-- ---------------------------------------------------------------------
-- select table_name, column_name from information_schema.columns
-- where table_schema = 'public' and table_name in ('parts','customers','assumptions')
-- order by table_name, ordinal_position;
