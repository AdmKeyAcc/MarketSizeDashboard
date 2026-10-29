-- =====================================================================
-- Migration v20 — Market Size & Actual per bulan
-- DIJALANKAN DI SUPABASE **MARKET SIZE**, SETELAH migration v19.
-- Aman dijalankan ulang.
-- =====================================================================

-- 1) Rincian Actual Januari–Desember (12 angka) di baris tahunan yang sudah ada.
--    Diisi oleh sinkron dari web Sales; kosong untuk data hasil upload laporan tahunan.
alter table public.actual_sales_year
  add column if not exists amount_by_month numeric[];

comment on column public.actual_sales_year.amount_by_month is 'Actual Rp per bulan Jan–Des (12 angka); null = hanya total tahunan';

-- 2) Fungsi sinkron atomik (v19) diperbarui supaya ikut menyimpan rincian bulanan.
create or replace function public.ms_replace_actual_year(p_year integer, p_rows jsonb, p_meta jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.actual_sales_year where year = p_year;

  insert into public.actual_sales_year (year, ka_type, customer_group, customer_name, product, amount, amount_by_month, source_filename, uploaded_at)
  select p_year, r.ka_type, coalesce(r.customer_group, ''), coalesce(r.customer_name, ''), r.product,
         coalesce(r.amount, 0),
         case when jsonb_typeof(r.amount_by_month) = 'array' and jsonb_array_length(r.amount_by_month) = 12
              then (select array_agg(coalesce(x::numeric, 0) order by i) from jsonb_array_elements_text(r.amount_by_month) with ordinality as e(x, i))
              else null end,
         r.source_filename, now()
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
         as r(ka_type text, customer_group text, customer_name text, product text, amount numeric, amount_by_month jsonb, source_filename text);
  get diagnostics n = row_count;

  insert into public.app_meta (key, value, updated_at)
  values ('actual_sales_year',
          coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('row_count', (select count(*) from public.actual_sales_year)),
          now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

  return n;
end;
$$;

revoke all on function public.ms_replace_actual_year(integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.ms_replace_actual_year(integer, jsonb, jsonb) to service_role;

-- 3) Kalender hari kerja per bulan (dipakai untuk membagi jam operasi setahun ke tiap bulan).
--    Ubah lewat Table Editor bila kalender kerja berbeda (mis. bulan Lebaran / cuti bersama).
insert into public.app_settings (key, value, description) values
  ('workdays_01', 22, 'Hari kerja Januari'),
  ('workdays_02', 20, 'Hari kerja Februari'),
  ('workdays_03', 22, 'Hari kerja Maret'),
  ('workdays_04', 22, 'Hari kerja April'),
  ('workdays_05', 21, 'Hari kerja Mei'),
  ('workdays_06', 22, 'Hari kerja Juni'),
  ('workdays_07', 23, 'Hari kerja Juli'),
  ('workdays_08', 21, 'Hari kerja Agustus'),
  ('workdays_09', 22, 'Hari kerja September'),
  ('workdays_10', 22, 'Hari kerja Oktober'),
  ('workdays_11', 21, 'Hari kerja November'),
  ('workdays_12', 22, 'Hari kerja Desember')
on conflict (key) do nothing;

-- Setelah menjalankan ini (dan SQL feed di Supabase Sales diperbarui), klik
-- "Sinkron ulang semua tahun" di menu Upload supaya rincian bulanan terisi.
