-- Migration v12: Actual Sales tahunan per customer (dari laporan "Laporan Sales")
-- Sumber: file Excel 3 tingkat KA Type -> Customer Group -> Customer, satu kolom nilai per tahun.
-- Tidak punya bulan / product / part number, jadi disimpan di tabel sendiri
-- (actual_sales_tx tetap untuk transaksi per part, boleh kosong).
-- Aman dijalankan berulang.
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

alter table actual_sales_year enable row level security;
drop policy if exists "public read actual_sales_year" on actual_sales_year;
create policy "public read actual_sales_year" on actual_sales_year for select using (true);

insert into app_meta (key, value) values
  ('actual_sales_year', '{"filename": null, "updated_at": null, "ytd_year": null, "ytd_month": null}')
on conflict (key) do nothing;

-- Data dummy transaksi lama (opsional, jalankan setelah data real masuk):
--   delete from actual_sales_tx;
--   delete from actual_sales;
