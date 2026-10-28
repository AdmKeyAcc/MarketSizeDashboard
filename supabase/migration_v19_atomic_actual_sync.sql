-- =====================================================================
-- Migration v19 — Sinkron Actual Sales tanpa "jeda" (atomik)
-- DIJALANKAN DI SUPABASE **MARKET SIZE**. Aman dijalankan ulang.
-- =====================================================================
-- Sebelumnya sinkron memasukkan data baru dulu lalu menghapus data lama, dalam
-- beberapa langkah terpisah. Kalau dashboard dibuka tepat di antara langkah itu,
-- Actual bisa terbaca ganda. Fungsi di bawah melakukan hapus + isi ulang + catat
-- metadata dalam SATU transaksi: pembaca selalu melihat versi lama utuh atau
-- versi baru utuh, tidak pernah campuran.
--
-- Hanya bisa dipanggil oleh server (service role), tidak dari browser.
-- Kode sinkron otomatis memakai fungsi ini kalau sudah ada; kalau belum,
-- tetap jalan dengan cara lama.
-- =====================================================================

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

  insert into public.actual_sales_year (year, ka_type, customer_group, customer_name, product, amount, source_filename, uploaded_at)
  select p_year, r.ka_type, coalesce(r.customer_group, ''), coalesce(r.customer_name, ''), r.product,
         coalesce(r.amount, 0), r.source_filename, now()
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
         as r(ka_type text, customer_group text, customer_name text, product text, amount numeric, source_filename text);
  get diagnostics n = row_count;

  insert into public.app_meta (key, value, updated_at)
  values ('actual_sales_year',
          coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('row_count', (select count(*) from public.actual_sales_year)),
          now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

  return n;
end;
$$;

create or replace function public.ms_replace_actual_tx(p_year integer, p_month text, p_rows jsonb, p_meta jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.actual_sales_tx where year = p_year and month = p_month;

  insert into public.actual_sales_tx (year, month, customer_group, customer_name, product, model, part_number, part_name, qty, amount, source_filename, uploaded_at)
  select p_year, p_month, r.customer_group, r.customer_name, coalesce(r.product, 'NO PRODUCT'), null, r.part_number, r.part_name,
         coalesce(r.qty, 0), coalesce(r.amount, 0), r.source_filename, now()
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
         as r(customer_group text, customer_name text, product text, part_number text, part_name text, qty numeric, amount numeric, source_filename text);
  get diagnostics n = row_count;

  insert into public.app_meta (key, value, updated_at)
  values ('actual_sales', coalesce(p_meta, '{}'::jsonb), now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

  return n;
end;
$$;

revoke all on function public.ms_replace_actual_year(integer, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.ms_replace_actual_tx(integer, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.ms_replace_actual_year(integer, jsonb, jsonb) to service_role;
grant execute on function public.ms_replace_actual_tx(integer, text, jsonb, jsonb) to service_role;
