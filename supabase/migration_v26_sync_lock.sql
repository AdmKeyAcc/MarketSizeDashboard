-- =====================================================================
-- Migration v26 — Sinkron Actual Sales tidak bisa bertabrakan
-- DIJALANKAN DI SUPABASE **MARKET SIZE**, SETELAH migration v20. Aman dijalankan ulang. Tidak menghapus data.
--
-- Sinkron bisa berjalan dari 3 tempat: jadwal otomatis tiap jam (pg_cron, menit ke-17), tombol "Sinkron sekarang",
-- dan tombol "Sinkron ulang semua tahun". Kalau dua sinkron untuk tahun / bulan yang sama berjalan bersamaan,
-- tanpa kunci keduanya bisa menghapus lalu mengisi ulang di waktu yang sama sehingga datanya dobel.
-- Migration ini menambahkan kunci (advisory lock): sinkron kedua MENUNGGU yang pertama selesai, lalu mengganti
-- datanya dengan hasil terbaru. Ringkasan Actual Qty (ms_refresh_actual_qty) sudah punya kunci sejak v21.
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
  -- Satu sinkron per tahun dalam satu waktu (jadwal otomatis & tombol sinkron tidak saling menimpa).
  perform pg_advisory_xact_lock(hashtext('ms_actual_year'), p_year);
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

create or replace function public.ms_replace_actual_tx(p_year integer, p_month text, p_rows jsonb, p_meta jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  -- Satu sinkron per bulan dalam satu waktu.
  perform pg_advisory_xact_lock(hashtext('ms_actual_tx'), p_year * 100 + coalesce(array_position(array['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'], p_month), 0));
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

revoke all on function public.ms_replace_actual_tx(integer, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.ms_replace_actual_tx(integer, text, jsonb, jsonb) to service_role;

-- Cek dobel (harus 0 baris):
--   select year, customer_group, customer_name, product, count(*) from actual_sales_year group by 1,2,3,4 having count(*) > 1;
