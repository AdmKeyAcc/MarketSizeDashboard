-- =====================================================================
-- Migration v21 — Actual Qty yang sebanding dengan Market Size (qty)
-- DIJALANKAN DI SUPABASE **MARKET SIZE**, SETELAH migration v20.
-- Aman dijalankan ulang.
--
-- Actual Qty = jumlah qty di actual_sales_tx (Actual per part per bulan, hasil sinkron web Sales)
-- HANYA untuk Part Number yang ada di Master Part (tabel parts) — sama seperti Market Size (qty)
-- yang hanya menghitung part di Master Part. Diringkas per tahun × customer × product (+ 12 angka bulanan)
-- supaya dashboard tidak perlu memuat ratusan ribu baris transaksi.
-- Diperbarui otomatis: setelah sinkron per bulan, dan setelah upload / hapus Master Part.
-- =====================================================================

create table if not exists public.actual_qty_year (
  year           integer not null,
  customer_group text    not null default '',
  customer_name  text    not null default '',
  product        text    not null,
  qty            numeric not null default 0,
  qty_by_month   numeric[] not null,
  refreshed_at   timestamptz not null default now()
);
create index if not exists actual_qty_year_year_idx on public.actual_qty_year (year);

comment on table public.actual_qty_year is 'Ringkasan Actual Qty (hanya Part Number di Master Part) per tahun × customer × product; diisi ms_refresh_actual_qty()';

-- Dibaca dashboard (anon) — sama seperti tabel Actual lainnya.
alter table public.actual_qty_year enable row level security;
drop policy if exists "read actual_qty_year" on public.actual_qty_year;
create policy "read actual_qty_year" on public.actual_qty_year for select using (true);
grant select on public.actual_qty_year to anon, authenticated;

-- Index pencocokan Part Number (huruf besar, tanpa spasi tepi).
create index if not exists parts_pn_norm_idx on public.parts (upper(btrim(part_number)));
create index if not exists actual_sales_tx_year_idx on public.actual_sales_tx (year);

-- Hitung ulang satu tahun (p_year) atau semua tahun (p_year = null).
create or replace function public.ms_refresh_actual_qty(p_year integer default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  -- Satu refresh dalam satu waktu (sinkron menjalankan beberapa bulan bersamaan).
  perform pg_advisory_xact_lock(hashtext('ms_refresh_actual_qty'));
  delete from public.actual_qty_year where p_year is null or year = p_year;

  insert into public.actual_qty_year (year, customer_group, customer_name, product, qty, qty_by_month, refreshed_at)
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

-- Isi pertama kali dari data yang sudah ada.
select public.ms_refresh_actual_qty(null);
