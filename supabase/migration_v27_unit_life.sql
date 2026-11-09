-- v27: umur unit di perhitungan Market Size (opsional — tanpa baris ini website memakai 10 tahun).
-- Unit BAST tahun X dihitung di Market Size tahun X sampai X + (umur − 1).
-- Untuk mengganti umur, ubah angka value di tabel app_settings (Table Editor) lalu refresh website.
insert into public.app_settings (key, value, description) values
  ('unit_life_years', 10, 'Umur unit (tahun) di Market Size: unit BAST tahun X dihitung tahun X s.d. X+9 bila 10')
on conflict (key) do nothing;
