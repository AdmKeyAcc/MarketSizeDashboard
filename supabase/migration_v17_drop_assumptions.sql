-- =====================================================================
-- Migration v17 — Hapus tabel assumptions
-- DIJALANKAN DI SUPABASE **MARKET SIZE**, SETELAH kode terbaru ter-deploy
-- (kode lama masih membaca tabel ini).
-- Hari kerja/bulan cadangan sekarang hanya dari app_settings.default_workdays_month.
-- =====================================================================

-- LANGKAH 0 — Cek isi (hanya membaca). Kalau ada nilai selain 22 yang
-- disengaja, catat dulu — setelah ini semua Product memakai satu angka cadangan.
select product, workdays_month from public.assumptions order by product;

-- LANGKAH 1 — Hapus
begin;
drop table if exists public.assumptions;
update public.app_settings
   set description = 'Hari kerja/bulan kalau kolom Day/Month di Data UIO kosong', updated_at = now()
 where key = 'default_workdays_month';
commit;
