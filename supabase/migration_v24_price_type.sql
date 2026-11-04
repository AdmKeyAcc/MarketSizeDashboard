-- =====================================================================
-- Migration v24 — Price Type: Kontrak / SCPL / Non-Kontrak
-- DIJALANKAN DI SUPABASE **MARKET SIZE**. Aman dijalankan ulang. Tidak menghapus data.
--
-- 1) Data UIO punya kolom Price Type per unit (Kontrak / SCPL / Non-Kontrak):
--    menentukan harga mana yang dipakai untuk unit customer tersebut.
-- 2) Data Harga Kontrak sekarang bisa berisi harga Kontrak ATAU SCPL (kolom Price Type di file).
--    Kunci harga menjadi Part Number + Customer Group + Price Type, supaya satu Customer Group
--    boleh punya harga Kontrak dan SCPL untuk part yang sama.
--    price_type: 'contract' = Kontrak, 'scpl' = SCPL, 'non_contract' = Non-Kontrak (harga umum).
-- =====================================================================

alter table public.uio_units add column if not exists price_type text;

-- Baris lama tanpa price_type dianggap sesuai jenisnya (customer_group kosong = non kontrak).
update public.price_list set price_type = 'non_contract' where price_type is null and coalesce(customer_group, '') = '';
update public.price_list set price_type = 'contract'     where price_type is null and coalesce(customer_group, '') <> '';

-- Kunci baru (part_number, customer_group, price_type). Indeks lama dilepas SETELAH yang baru jadi.
create unique index if not exists price_list_natural_key_v24 on public.price_list (part_number, customer_group, price_type);
drop index if exists public.price_list_natural_key;

-- Cek:
--   select price_type, count(*) from price_list group by 1;
--   select price_type, count(*) from uio_units group by 1;
