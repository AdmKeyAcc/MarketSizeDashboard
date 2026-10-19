-- =====================================================================
-- Cek konsistensi data antar tabel (HANYA SELECT — aman, tidak mengubah apa pun)
-- Jalankan satu blok per kali di Supabase SQL Editor, lalu baca hasilnya.
-- Aplikasi mencocokkan customer lewat kunci:  UPPER(TRIM(group)) | UPPER(TRIM(name))
-- dan part lewat part_number persis sama. Yang tidak cocok = datanya "tidak nyambung".
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. RINGKASAN: jumlah baris & kelengkapan tiap tabel
-- ---------------------------------------------------------------------
select 'parts' as tabel, count(*) as baris from parts
union all select 'customers', count(*) from customers
union all select 'uio_units', count(*) from uio_units
union all select 'price_list', count(*) from price_list
union all select 'actual_sales_tx', count(*) from actual_sales_tx
union all select 'assumptions', count(*) from assumptions;

select
  count(*)                                                     as total_unit,
  count(*) filter (where coalesce(trim(customer_code), '') = '') as tanpa_customer_code,
  count(*) filter (where coalesce(trim(customer_type), '') = '') as tanpa_customer_type,
  count(*) filter (where coalesce(trim(customer_name), '') = '') as tanpa_customer_name,
  count(*) filter (where year is null)                          as tanpa_tahun
from uio_units;

-- ---------------------------------------------------------------------
-- 1. Customer di Data UIO yang TIDAK ada di tabel customers
--    (akibatnya: KA Tier kosong, dan customer tidak muncul di filter/Summary)
-- ---------------------------------------------------------------------
select upper(trim(coalesce(u.customer_group, ''))) as customer_group,
       upper(trim(coalesce(u.customer_name, '')))  as customer_name,
       count(*) as jumlah_unit
from uio_units u
where coalesce(trim(u.customer_name), '') <> ''
  and not exists (
    select 1 from customers c
    where upper(trim(coalesce(c.customer_group, ''))) = upper(trim(coalesce(u.customer_group, '')))
      and upper(trim(coalesce(c.customer_name, '')))  = upper(trim(coalesce(u.customer_name, '')))
  )
group by 1, 2
order by jumlah_unit desc
limit 200;

-- ---------------------------------------------------------------------
-- 2. Customer di Actual Sales yang TIDAK ada di Data UIO
--    (akibatnya: actual sales tidak masuk ke baris customer mana pun / market share salah)
-- ---------------------------------------------------------------------
select upper(trim(coalesce(t.customer_group, ''))) as customer_group,
       upper(trim(coalesce(t.customer_name, '')))  as customer_name,
       count(*) as jumlah_transaksi,
       round(sum(t.amount)) as total_amount
from actual_sales_tx t
where not exists (
    select 1 from uio_units u
    where upper(trim(coalesce(u.customer_group, ''))) = upper(trim(coalesce(t.customer_group, '')))
      and upper(trim(coalesce(u.customer_name, '')))  = upper(trim(coalesce(t.customer_name, '')))
  )
group by 1, 2
order by total_amount desc nulls last
limit 200;

-- ---------------------------------------------------------------------
-- 3. Customer yang namanya MIRIP tapi dianggap beda
--    (beda hanya spasi ganda / tanda baca / "PT" / "CV") — kandidat typo yang perlu disatukan
-- ---------------------------------------------------------------------
with semua as (
  select customer_group, customer_name from customers
  union select customer_group, customer_name from uio_units
  union select customer_group, customer_name from actual_sales_tx
), bersih as (
  select upper(trim(coalesce(customer_group, ''))) as grp,
         upper(trim(coalesce(customer_name, '')))  as nama,
         regexp_replace(
           regexp_replace(upper(coalesce(customer_name, '')), '\m(PT|CV|TBK|PERSERO)\M', '', 'g'),
           '[^A-Z0-9]', '', 'g') as nama_inti
  from semua
  where coalesce(trim(customer_name), '') <> ''
)
select nama_inti, count(distinct grp || '|' || nama) as variasi,
       array_agg(distinct grp || ' | ' || nama) as ejaan
from bersih
group by nama_inti
having count(distinct grp || '|' || nama) > 1
order by variasi desc
limit 100;

-- ---------------------------------------------------------------------
-- 4. Part di Actual Sales yang TIDAK ada di master parts (by part_number)
-- ---------------------------------------------------------------------
select t.part_number, max(t.part_name) as part_name, count(*) as transaksi, round(sum(t.amount)) as total_amount
from actual_sales_tx t
where coalesce(trim(t.part_number), '') <> ''
  and not exists (select 1 from parts p where p.part_number = t.part_number)
group by t.part_number
order by total_amount desc nulls last
limit 200;

-- ---------------------------------------------------------------------
-- 5. Part di price_list yang TIDAK ada di master parts
--    (harga ter-upload tapi tidak pernah terpakai)
-- ---------------------------------------------------------------------
select pl.part_number, pl.price_type, pl.customer_group, pl.price
from price_list pl
where not exists (select 1 from parts p where p.part_number = pl.part_number)
order by pl.part_number
limit 200;

-- ---------------------------------------------------------------------
-- 6. Part di master parts yang TIDAK punya harga sama sekali
--    (pricelist 0 dan tidak ada di price_list -> amount market size = 0)
-- ---------------------------------------------------------------------
select p.product, p.model, p.part_number, p.part_name
from parts p
where coalesce(p.pricelist, 0) = 0
  and not exists (select 1 from price_list pl where pl.part_number = p.part_number)
order by p.product, p.model
limit 200;

-- ---------------------------------------------------------------------
-- 7. Model unit di Data UIO yang tidak ada di master parts
--    (model dinormalisasi: huruf besar, tanpa spasi/tanda hubung — sama seperti di aplikasi)
-- ---------------------------------------------------------------------
select upper(trim(u.product)) as product, upper(trim(u.model)) as model, count(*) as jumlah_unit
from uio_units u
where coalesce(trim(u.model), '') <> ''
  and not exists (
    select 1 from parts p
    where regexp_replace(upper(p.model), '[\s\-_/]+', '', 'g') = regexp_replace(upper(u.model), '[\s\-_/]+', '', 'g')
  )
group by 1, 2
order by jumlah_unit desc
limit 200;

-- ---------------------------------------------------------------------
-- 8. Duplikat: satu customer_code dipakai >1 nama, atau satu nama punya >1 code
-- ---------------------------------------------------------------------
select customer_code, count(distinct upper(trim(customer_name))) as jumlah_nama,
       array_agg(distinct upper(trim(customer_name))) as nama
from customers
where coalesce(trim(customer_code), '') <> ''
group by customer_code
having count(distinct upper(trim(customer_name))) > 1;

select upper(trim(customer_name)) as nama, count(distinct customer_code) as jumlah_code,
       array_agg(distinct customer_code) as code
from customers
where coalesce(trim(customer_name), '') <> ''
group by 1
having count(distinct customer_code) > 1;

-- ---------------------------------------------------------------------
-- 9. Satu customer punya >1 Customer Type di Data UIO (sel Cust. Type di Summary jadi "A, B")
-- ---------------------------------------------------------------------
select upper(trim(customer_group)) as customer_group, upper(trim(customer_name)) as customer_name,
       array_agg(distinct customer_type) as tipe
from uio_units
where coalesce(trim(customer_type), '') <> ''
group by 1, 2
having count(distinct customer_type) > 1
limit 100;

-- ---------------------------------------------------------------------
-- 10. Customer Group di Actual Sales tahunan yang TIDAK ada di Master Customer
--     (nilai penjualannya tetap tampil di Summary, tapi tidak punya Market Size kalau tidak ada UIO-nya)
-- ---------------------------------------------------------------------
select a.customer_group, sum(a.amount) as total_penjualan_semua_tahun
from actual_sales_year a
where upper(trim(a.customer_group)) not in (
  select upper(trim(coalesce(nullif(c.customer_group, ''), c.customer_name))) from customers c
)
group by 1
order by 2 desc
limit 100;

-- ---------------------------------------------------------------------
-- 11. Customer Group di Actual Sales tahunan yang tidak punya unit di Data UIO
--     (Market Size = 0 untuk grup ini; sering karena ejaan nama grup berbeda dengan Data UIO)
-- ---------------------------------------------------------------------
select a.customer_group, sum(a.amount) as total_penjualan_semua_tahun
from actual_sales_year a
where upper(trim(a.customer_group)) not in (
  select upper(trim(coalesce(nullif(u.customer_group, ''), u.customer_name))) from uio_units u
)
group by 1
order by 2 desc
limit 100;

-- ---------------------------------------------------------------------
-- 12. Customer yang muncul di lebih dari satu KA Type di laporan Actual Sales
-- ---------------------------------------------------------------------
select customer_group, customer_name, array_agg(distinct ka_type) as ka_type
from actual_sales_year
group by 1, 2
having count(distinct ka_type) > 1
order by 1, 2
limit 100;
