-- =====================================================================
-- Migration v25 — Harga Kontrak / SCPL dicocokkan lewat Customer Code
-- DIJALANKAN DI SUPABASE **MARKET SIZE**, SETELAH migration v24. Aman dijalankan ulang. Tidak menghapus data.
--
-- Aturan harga:
--   * Customer kontrak = Customer Code-nya punya harga di Data Harga Kontrak / SCPL → pakai harga nett itu.
--   * Selain itu non kontrak → Harga Non Kontrak (harga tertera − 50%).
-- Karena itu kunci Data Harga menjadi Part Number + Customer Code + Customer Group + Price Type.
-- Baris kontrak lama yang belum punya Customer Code tetap disimpan, tetapi tidak dipakai lagi —
-- upload ulang Data Harga Kontrak / SCPL lengkap dengan kolom Cust. Code.
-- =====================================================================

update public.price_list set customer_code = upper(btrim(customer_code)) where customer_code is not null;
update public.price_list set customer_code = '' where customer_code is null;
alter table public.price_list alter column customer_code set default '';
alter table public.price_list alter column customer_code set not null;

create unique index if not exists price_list_natural_key_v25
  on public.price_list (part_number, customer_code, customer_group, price_type);
drop index if exists public.price_list_natural_key_v24;
create index if not exists price_list_customer_code_idx on public.price_list (customer_code);

-- Cek: berapa harga kontrak/SCPL yang sudah punya Customer Code
--   select price_type, (customer_code <> '') as ada_kode, count(*) from price_list group by 1, 2 order by 1, 2;
