-- =====================================================================
-- DIJALANKAN DI SUPABASE **SALES** (bukan Market Size)
-- Feed Actual Sales untuk website Market Size — baca-saja, ber-token
-- =====================================================================
-- Yang dibuat:
--   1. Index (year, month) di tabel master supaya ringkasan cepat.
--   2. Schema privat `ms_private` berisi token rahasia (tidak bisa dibaca dari API).
--   3. Fungsi `ms_feed(...)` yang mengembalikan RINGKASAN (bukan baris mentah)
--      dan hanya mau jalan kalau token-nya benar.
--
-- Yang TIDAK berubah: tabel master, RLS, dan login website Sales tetap seperti
-- sekarang. Fungsi ini tidak bisa menulis atau menghapus apa pun.
--
-- Setelah menjalankan file ini, jalankan query di bagian paling bawah untuk
-- melihat token, lalu simpan di Vercel (project Market Size) sebagai
-- SALES_FEED_TOKEN.
-- Aman dijalankan ulang; token lama tetap dipakai.
-- =====================================================================

-- 1) Index
create index if not exists master_year_month_idx on public.master (year, month);

-- 2) Token rahasia
create schema if not exists ms_private;
revoke all on schema ms_private from public;
revoke all on schema ms_private from anon, authenticated;

create table if not exists ms_private.feed_token (
  id         integer primary key default 1 check (id = 1),
  token      text not null,
  created_at timestamptz not null default now()
);

insert into ms_private.feed_token (id, token)
values (1, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (id) do nothing;

-- 3) Fungsi feed
--   p_kind = 'info'  → rentang data: {min_year, max_year, max_date, rows}
--   p_kind = 'year'  → per tahun: KA Type × Customer Group × Customer × Product → Rp & Qty (+ mm: Rp per bulan)
--   p_kind = 'month' → per bulan: Customer Group × Customer × Product × Material → Rp & Qty
--   p_exclude        → daftar business_area yang dikecualikan (mis. {JKT,SBY,SMG,BDG})
create or replace function public.ms_feed(
  p_token   text,
  p_kind    text,
  p_year    integer default null,
  p_month   integer default null,
  p_exclude text[]  default '{}'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, ms_private
as $$
declare
  res jsonb;
begin
  if not exists (select 1 from ms_private.feed_token t where t.token = p_token) then
    raise exception 'ms_feed: token tidak valid' using errcode = '28000';
  end if;

  if p_kind = 'info' then
    select jsonb_build_object(
             'min_year', min(m.year),
             'max_year', max(m.year),
             'max_date', max(m.posting_date),
             'rows',     count(*)
           )
      into res
      from public.master m
     where coalesce(m.business_area, '') <> all (coalesce(p_exclude, '{}'));

  elsif p_kind = 'year' then
    if p_year is null then raise exception 'ms_feed: p_year wajib diisi'; end if;
    select coalesce(jsonb_agg(t), '[]'::jsonb)
      into res
      from (
        select upper(trim(coalesce(m.key_account_type, ''))) as ka,
               trim(coalesce(m.cust_group, ''))               as cg,
               trim(coalesce(m.cust_name, ''))                as cn,
               trim(coalesce(m.product, ''))                  as p,
               sum(coalesce(m.amount_in_local_currency, 0))   as amt,
               sum(coalesce(m.quantity, 0))                   as qty,
               -- rincian Januari–Desember (12 angka) untuk Market Share per bulan
               jsonb_build_array(
                 coalesce(sum(m.amount_in_local_currency) filter (where m.month = 1), 0),
                 coalesce(sum(m.amount_in_local_currency) filter (where m.month = 2), 0),
                 coalesce(sum(m.amount_in_local_currency) filter (where m.month = 3), 0),
                 coalesce(sum(m.amount_in_local_currency) filter (where m.month = 4), 0),
                 coalesce(sum(m.amount_in_local_currency) filter (where m.month = 5), 0),
                 coalesce(sum(m.amount_in_local_currency) filter (where m.month = 6), 0),
                 coalesce(sum(m.amount_in_local_currency) filter (where m.month = 7), 0),
                 coalesce(sum(m.amount_in_local_currency) filter (where m.month = 8), 0),
                 coalesce(sum(m.amount_in_local_currency) filter (where m.month = 9), 0),
                 coalesce(sum(m.amount_in_local_currency) filter (where m.month = 10), 0),
                 coalesce(sum(m.amount_in_local_currency) filter (where m.month = 11), 0),
                 coalesce(sum(m.amount_in_local_currency) filter (where m.month = 12), 0)
               )                                              as mm
          from public.master m
         where m.year = p_year
           and coalesce(m.business_area, '') <> all (coalesce(p_exclude, '{}'))
         group by 1, 2, 3, 4
      ) t;

  elsif p_kind = 'month' then
    if p_year is null or p_month is null then raise exception 'ms_feed: p_year & p_month wajib diisi'; end if;
    select coalesce(jsonb_agg(t), '[]'::jsonb)
      into res
      from (
        select trim(coalesce(m.cust_group, ''))               as cg,
               trim(coalesce(m.cust_name, ''))                as cn,
               trim(coalesce(m.product, ''))                  as p,
               trim(coalesce(m.material, ''))                 as pn,
               max(m.material_description)                    as pd,
               sum(coalesce(m.amount_in_local_currency, 0))   as amt,
               sum(coalesce(m.quantity, 0))                   as qty
          from public.master m
         where m.year = p_year
           and m.month = p_month
           and coalesce(m.business_area, '') <> all (coalesce(p_exclude, '{}'))
         group by 1, 2, 3, 4
      ) t;

  else
    raise exception 'ms_feed: p_kind harus info / year / month';
  end if;

  return res;
end;
$$;

revoke all on function public.ms_feed(text, text, integer, integer, text[]) from public;
grant execute on function public.ms_feed(text, text, integer, integer, text[]) to anon, authenticated;

-- ---------------------------------------------------------------------
-- LIHAT TOKEN (jalankan terpisah, salin hasilnya ke Vercel → SALES_FEED_TOKEN)
-- ---------------------------------------------------------------------
-- select token from ms_private.feed_token;

-- Ganti token kalau bocor (lalu perbarui SALES_FEED_TOKEN di Vercel):
-- update ms_private.feed_token set token = replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','') where id = 1;

-- Uji cepat (ganti XXX dengan token):
-- select public.ms_feed('XXX', 'info', null, null, '{JKT,SBY,SMG,BDG}');
