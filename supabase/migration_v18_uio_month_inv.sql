-- =====================================================================
-- Migration v18 — Kolom Month Inv (bulan invoice/pembelian unit) di Data UIO
-- DIJALANKAN DI SUPABASE **MARKET SIZE**, SEBELUM kode baru ter-deploy
-- (kode baru menyimpan kolom ini saat upload Data UIO).
-- Aman dijalankan ulang. Data lama tidak berubah (Month Inv kosong =
-- unit dianggap beroperasi setahun penuh di tahun belinya, sama seperti sebelumnya).
-- =====================================================================
alter table public.uio_units
  add column if not exists month_inv smallint;

alter table public.uio_units drop constraint if exists uio_units_month_inv_chk;
alter table public.uio_units
  add constraint uio_units_month_inv_chk check (month_inv is null or month_inv between 1 and 12);

comment on column public.uio_units.year      is 'Year Inv — tahun invoice/pembelian unit';
comment on column public.uio_units.month_inv is 'Month Inv — bulan invoice/pembelian unit (1–12)';
