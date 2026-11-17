-- v29: kunci unit Data UIO sekarang Product + Model + Serial Number (sebelumnya Product + Serial Number).
-- Menghitung ulang kolom dedupe_key untuk unit yang sudah ada supaya mode "Tambah / perbarui" dan upload cabang
-- mencocokkan unit dengan aturan baru. Tidak ada unit yang dihapus atau diubah selain kolom dedupe_key.
-- (Kunci baru selalu lebih rinci dari kunci lama, jadi tidak mungkin bentrok.)
-- Jalankan sekali di Supabase (database Market Size) → SQL Editor → Run.
update public.uio_units
set dedupe_key = upper(btrim(coalesce(product, ''))) || '::' || upper(btrim(coalesce(model, ''))) || '::' || upper(btrim(serial_number))
where dedupe_key not like 'no-serial::%'
  and serial_number is not null;
