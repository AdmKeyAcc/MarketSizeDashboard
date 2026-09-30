# Market Size Dashboard

Dashboard + kalkulator market size spare part, dengan data tersimpan di
Supabase dan di-hosting di Vercel. Dibangun dengan Next.js (App Router).

Fitur utama:
- Dashboard: KPI, grafik comparison market size vs actual sales, tabel detail part.
- 12 filter (Tahun, Bulan, Area, Business Area, Customer Group, Customer Name, PSS, Product, Model Unit, Component, Material Desc, Material) — beberapa cascading (Customer Name ikut Customer Group/Area, Model Unit ikut Product/Business Area).
- Kalkulator: mode cepat (satu part) dan mode massal (edit asumsi HM/Day, UIO, diskon lalu lihat dampaknya ke total — simulasi lokal di browser, belum menulis ke Supabase).
- Summary part yang dicek: dari kalkulator cepat, part yang sedang dihitung bisa "ditambahkan" ke daftar summary di bawahnya (mengumpulkan beberapa part sekaligus, tiap baris membekukan angka pada saat ditambahkan), lalu daftar itu bisa diekspor jadi file Excel (.xlsx).
- Upload data (.xlsx/.csv) untuk 3 sumber: template kalkulator, data customer & UIO, actual sales bulanan — semua tersimpan permanen di Supabase, bukan cuma di satu browser.

## 1. Siapkan Supabase

1. Buat project baru di [supabase.com](https://supabase.com).
2. Buka **SQL Editor**, jalankan seluruh isi `supabase/schema.sql`. Ini membuat tabel `parts`, `uio_master`, `assumptions`, `customers`, `actual_sales`, `app_meta`, plus Row Level Security (publik hanya bisa **membaca**; semua tulis lewat service role key di server).
3. Di **Project Settings → API**, catat tiga nilai ini untuk langkah berikutnya:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (rahasia, jangan pernah expose ke browser)

## 2. Jalankan secara lokal

```bash
cp .env.example .env.local
# isi tiga nilai di atas ke .env.local

npm install
node --env-file=.env.local scripts/seed.mjs   # isi data contoh (sekali saja)
npm run dev
```

Buka http://localhost:3000. Data contoh yang muncul persis sama dengan angka
di template Excel asli (Rp 201,4 M/tahun) — actual sales-nya masih data
simulasi sampai Anda upload yang sungguhan lewat tombol ⭱ di halaman.

## 3. Deploy ke Vercel

1. Push folder ini ke sebuah repo Git (GitHub/GitLab/Bitbucket).
2. Di [vercel.com](https://vercel.com) → **Add New Project** → import repo tersebut. Vercel akan otomatis mendeteksi Next.js.
3. Di **Environment Variables**, isi tiga variabel yang sama seperti `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
4. Deploy. Setiap upload lewat dashboard akan langsung tersimpan ke Supabase yang sama, terlihat oleh siapa pun yang mengakses URL Vercel tersebut.

Kalau belum sempat menjalankan `scripts/seed.mjs` secara lokal, jalankan
sekali dari komputer manapun yang bisa mengakses internet — script ini hanya
butuh `NEXT_PUBLIC_SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY`, tidak perlu
dijalankan di Vercel.

## Struktur data & bagaimana upload bekerja

| Upload | Sheet/kolom yang dicari | Efeknya di database |
|---|---|---|
| Template kalkulator (.xlsx) | Sheet `Data input 1`, tabel UIO di kolom B–E (baris 11+), tabel part di kolom G–U (baris 9+) | **Mengganti seluruh** isi tabel `parts`, `uio_master`, `assumptions` |
| Data customer (.xlsx) | Sheet `Cust Data`, kolom Customer Group/Cabang/Customer Code/Customer Name/PSS + UIO per brand | **Mengganti seluruh** isi tabel `customers` |
| Actual sales (.xlsx/.csv) | Kolom `Tahun, Bulan, Product, Actual Sales` (unduh contoh lewat tombol di modal upload) | **Upsert** per (Tahun, Bulan, Product) — bulan lain tidak terhapus |

Parser di `lib/parse/*.ts` sudah divalidasi baris-per-baris terhadap kedua
file Excel asli (0 selisih pada 525 baris part, 60 baris customer, dan total
Rp 201.402.207.200 cocok persis).

## Keputusan desain & yang masih perlu diputuskan

- **Belum ada autentikasi.** Siapa pun yang punya URL Vercel bisa melihat
  *dan mengupload* data (upload diproses lewat API route dengan service role
  key, jadi kredensial database tidak pernah sampai ke browser — tapi
  endpoint-nya sendiri masih terbuka untuk publik). Kalau dashboard ini akan
  dipakai lebih luas, tambahkan [Supabase Auth](https://supabase.com/docs/guides/auth)
  (misalnya batasi ke domain email perusahaan) sebelum production sungguhan.
- **Estimasi per customer/area** memakai proporsi UIO per brand dari data
  customer yang di-upload — bukan data UIO per customer per model unit yang
  sebenarnya (karena belum ada). Lihat tombol ⓘ di dashboard untuk detail.
- **Business Area** adalah pengelompokan brand yang saya usulkan sendiri
  (`lib/types.ts` → `BUSINESS_AREA_MAP`), belum dikonfirmasi tim TRAKNUS.
- **Kalkulator tab** murni simulasi lokal (localStorage per browser) dan
  belum menulis balik ke Supabase — kalau perlu skenario tersimpan/dibagi
  antar user, itu butuh tabel & UI tambahan (bisa ditambahkan).
- **Fitur yang sudah dihapus setelah evaluasi** (supaya semua yang tampil
  di dashboard benar-benar berfungsi, bukan sekadar tempelan): kolom "No
  Mesin/No Rangka" (dulu cuma format ilustrasi, tidak ada data asli di
  baliknya) dan filter "Key Account" (dulu di-hardcode ke satu nama dan
  tidak benar-benar terhubung ke data yang diupload). Keduanya bisa
  ditambahkan kembali secara *proper* kalau nanti ada sumber data aslinya
  (master data unit per mesin fisik, dan kolom Key Account per customer).
- **Keamanan dependensi:** semua dependency dipin ke versi ter-patch per
  September 2026, kecuali satu isu `postcss` bawaan internal Next.js sendiri
  (bukan dependency langsung proyek ini) yang baru diperbaiki di Next 16 —
  risikonya rendah (cuma dipakai saat build, bukan saat runtime melayani
  request), tapi jalankan `npm audit` sendiri secara berkala.

## Struktur folder

```
app/
  page.tsx                 Server Component: fetch awal dari Supabase
  api/upload/**/route.ts   Endpoint upload (pakai service role key)
  globals.css              Design system (tema merah-biru, sudut tajam/square)
components/                Semua UI (client components)
hooks/                     State: data+filter, calculator overrides, theme
lib/
  calculations.ts          Semua rumus & logika alokasi (murni, bisa ditest)
  parse/                   Parser .xlsx (divalidasi terhadap file asli)
  supabase/                Client browser (anon) & server (service role)
supabase/schema.sql         Skema database + Row Level Security
scripts/seed.mjs            Isi data contoh sekali di awal
data/sample/                 Data contoh yang dipakai scripts/seed.mjs
```
