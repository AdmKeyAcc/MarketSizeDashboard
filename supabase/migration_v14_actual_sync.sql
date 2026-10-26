-- =====================================================================
-- Migration v14 — Sinkron otomatis Actual Sales dari web Sales
-- DIJALANKAN DI SUPABASE **MARKET SIZE**
-- =====================================================================
-- Jalankan BAGIAN A sekarang. BAGIAN B (jadwal otomatis) dijalankan setelah
-- kode baru ter-deploy di Vercel dan tombol "Sinkron" sudah dicoba berhasil.
-- Aman dijalankan ulang.
-- =====================================================================

-- ============================ BAGIAN A ===============================

-- A1) Cabang (business_area) yang TIDAK dihitung sebagai Actual Market Size.
--     Default = 4 cabang Jawa, sesuai Laporan Sales yang selama ini dipakai
--     (sudah dicek: total 2024–2026 cocok sampai rupiah terakhir).
--     Ubah lewat Table Editor kalau cakupan berubah, lalu klik "Sinkron ulang semua".
create table if not exists public.actual_branch_exclusions (
  business_area text primary key,
  note          text,
  updated_at    timestamptz not null default now()
);

insert into public.actual_branch_exclusions (business_area, note) values
  ('JKT', 'Jakarta — di luar cakupan Market Size'),
  ('SBY', 'Surabaya — di luar cakupan Market Size'),
  ('SMG', 'Semarang — di luar cakupan Market Size'),
  ('BDG', 'Bandung — di luar cakupan Market Size')
on conflict (business_area) do nothing;

alter table public.actual_branch_exclusions enable row level security;
drop policy if exists "public read actual_branch_exclusions" on public.actual_branch_exclusions;
create policy "public read actual_branch_exclusions" on public.actual_branch_exclusions for select using (true);

-- A2) Index supaya hapus/isi ulang per tahun & per bulan cepat.
create index if not exists actual_sales_year_year_idx on public.actual_sales_year (year);
create index if not exists actual_sales_tx_year_month_idx on public.actual_sales_tx (year, month);


-- ============================ BAGIAN B ===============================
-- Jadwal otomatis tiap jam (pg_cron + pg_net). Jalankan SETELAH deploy.
-- Ganti URL di bawah kalau domain Vercel berbeda.

create extension if not exists pg_net;
create extension if not exists pg_cron;

create schema if not exists ms_private;
revoke all on schema ms_private from public;
revoke all on schema ms_private from anon, authenticated;

create table if not exists ms_private.sync_config (
  id   integer primary key default 1 check (id = 1),
  url  text not null
);
insert into ms_private.sync_config (id, url)
values (1, 'https://market-size-dashboard-tr.vercel.app/api/sync/actual-sales')
on conflict (id) do update set url = excluded.url;

-- Kirim satu permintaan sinkron per unit (tahun / bulan) ke Vercel.
-- Tahun berjalan: ringkasan tahunan + tiap bulan s/d bulan ini.
-- Januari–Februari: tahun lalu ikut disinkron (posting susulan akhir tahun).
create or replace function ms_private.trigger_actual_sync()
returns void
language plpgsql
security definer
set search_path = public, ms_private
as $$
declare
  v_url   text;
  v_now   timestamp := now() at time zone 'Asia/Jakarta';
  v_year  integer   := extract(year from v_now)::int;
  v_month integer   := extract(month from v_now)::int;
  y integer;
  m integer;
  last_m integer;
begin
  select url into v_url from ms_private.sync_config where id = 1;
  if v_url is null then return; end if;

  for y in (case when v_month <= 2 then v_year - 1 else v_year end) .. v_year loop
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('unit', 'year', 'year', y, 'source', 'cron'),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 60000
    );
    last_m := case when y = v_year then v_month else 12 end;
    for m in 1 .. last_m loop
      perform net.http_post(
        url := v_url,
        body := jsonb_build_object('unit', 'month', 'year', y, 'month', m, 'source', 'cron'),
        headers := '{"Content-Type": "application/json"}'::jsonb,
        timeout_milliseconds := 60000
      );
    end loop;
  end loop;
end;
$$;

revoke all on function ms_private.trigger_actual_sync() from public;

-- Jadwal: tiap jam pada menit ke-17.
select cron.unschedule('ms-actual-sync') where exists (select 1 from cron.job where jobname = 'ms-actual-sync');
select cron.schedule('ms-actual-sync', '17 * * * *', $$select ms_private.trigger_actual_sync();$$);

-- Cek jadwal & hasil:
--   select * from cron.job where jobname = 'ms-actual-sync';
--   select * from cron.job_run_details order by start_time desc limit 10;
--   select id, status_code, left(content::text, 200) from net._http_response order by created desc limit 20;
-- Matikan jadwal:
--   select cron.unschedule('ms-actual-sync');
