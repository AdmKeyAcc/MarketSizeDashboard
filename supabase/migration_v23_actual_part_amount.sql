-- =====================================================================
-- Migration v23 — Actual (Rp) yang sebanding dengan Market Size
-- DIJALANKAN DI SUPABASE **MARKET SIZE**, SETELAH migration v21 & v22. Aman dijalankan ulang.
--
-- Ringkasan actual_qty_year (Actual per part, hanya Part Number di Master Part) ditambah Rupiah-nya.
-- Dashboard memakai angka ini untuk Actual Sales, sehingga Actual dan Market Size menghitung
-- PART YANG SAMA (sebelumnya Actual = semua part dari brand tersebut → share bisa > 100%).
-- =====================================================================

alter table public.actual_qty_year add column if not exists amount numeric not null default 0;
alter table public.actual_qty_year add column if not exists amount_by_month numeric[];

create or replace function public.ms_refresh_actual_qty(p_year integer default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  -- Satu refresh dalam satu waktu.
  perform pg_advisory_xact_lock(hashtext('ms_refresh_actual_qty'));
  delete from public.actual_qty_year where p_year is null or year = p_year;

  insert into public.actual_qty_year (year, customer_group, customer_name, product, qty, qty_by_month, amount, amount_by_month, refreshed_at)
  select t.year,
         coalesce(btrim(t.customer_group), ''),
         coalesce(btrim(t.customer_name), ''),
         t.product,
         sum(t.qty),
         array[
           coalesce(sum(t.qty) filter (where t.m = 1), 0),  coalesce(sum(t.qty) filter (where t.m = 2), 0),
           coalesce(sum(t.qty) filter (where t.m = 3), 0),  coalesce(sum(t.qty) filter (where t.m = 4), 0),
           coalesce(sum(t.qty) filter (where t.m = 5), 0),  coalesce(sum(t.qty) filter (where t.m = 6), 0),
           coalesce(sum(t.qty) filter (where t.m = 7), 0),  coalesce(sum(t.qty) filter (where t.m = 8), 0),
           coalesce(sum(t.qty) filter (where t.m = 9), 0),  coalesce(sum(t.qty) filter (where t.m = 10), 0),
           coalesce(sum(t.qty) filter (where t.m = 11), 0), coalesce(sum(t.qty) filter (where t.m = 12), 0)
         ]::numeric[],
         sum(t.amount),
         array[
           coalesce(sum(t.amount) filter (where t.m = 1), 0),  coalesce(sum(t.amount) filter (where t.m = 2), 0),
           coalesce(sum(t.amount) filter (where t.m = 3), 0),  coalesce(sum(t.amount) filter (where t.m = 4), 0),
           coalesce(sum(t.amount) filter (where t.m = 5), 0),  coalesce(sum(t.amount) filter (where t.m = 6), 0),
           coalesce(sum(t.amount) filter (where t.m = 7), 0),  coalesce(sum(t.amount) filter (where t.m = 8), 0),
           coalesce(sum(t.amount) filter (where t.m = 9), 0),  coalesce(sum(t.amount) filter (where t.m = 10), 0),
           coalesce(sum(t.amount) filter (where t.m = 11), 0), coalesce(sum(t.amount) filter (where t.m = 12), 0)
         ]::numeric[],
         now()
    from (
      select x.*,
             array_position(array['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'], x.month) as m
        from public.actual_sales_tx x
       where (p_year is null or x.year = p_year)
         and x.part_number is not null
         and exists (select 1 from public.parts p where upper(btrim(p.part_number)) = upper(btrim(x.part_number)))
    ) t
   group by 1, 2, 3, 4;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.ms_refresh_actual_qty(integer) from public, anon, authenticated;
grant execute on function public.ms_refresh_actual_qty(integer) to service_role;

-- Isi ulang per tahun (bukan sekaligus, supaya tidak kena batas waktu).
do $$
declare y integer;
begin
  for y in select distinct year from public.actual_sales_tx order by 1 loop
    perform public.ms_refresh_actual_qty(y);
  end loop;
end $$;

-- Cek: select year, count(*), round(sum(amount)/1e9,1) as actual_m, sum(qty) from actual_qty_year group by 1 order by 1;
