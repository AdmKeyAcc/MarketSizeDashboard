-- =====================================================================
-- Migration v22 — Jadwal ringkasan Actual Qty
-- DIJALANKAN DI SUPABASE **MARKET SIZE**, SETELAH migration v21. Aman dijalankan ulang.
--
-- Sinkron otomatis tiap jam (menit ke-17) mengisi Actual per part per bulan. Ringkasan Actual Qty
-- (actual_qty_year) dihitung SEKALI sesudahnya, di menit ke-37, hanya untuk tahun yang ikut disinkron
-- (tahun berjalan; Januari–Februari juga tahun lalu). Tidak lagi dihitung tiap bulan → database tidak terbebani.
-- =====================================================================

create or replace function ms_private.refresh_recent_actual_qty()
returns void
language plpgsql
security definer
set search_path = public, ms_private
as $$
declare
  v_now   timestamp := now() at time zone 'Asia/Jakarta';
  v_year  integer   := extract(year from v_now)::int;
  v_month integer   := extract(month from v_now)::int;
  y integer;
begin
  for y in (case when v_month <= 2 then v_year - 1 else v_year end) .. v_year loop
    perform public.ms_refresh_actual_qty(y);
  end loop;
end;
$$;

revoke all on function ms_private.refresh_recent_actual_qty() from public;

select cron.unschedule('ms-actual-qty-refresh') where exists (select 1 from cron.job where jobname = 'ms-actual-qty-refresh');
select cron.schedule('ms-actual-qty-refresh', '37 * * * *', $$select ms_private.refresh_recent_actual_qty();$$);

-- Cek: select * from cron.job where jobname = 'ms-actual-qty-refresh';
