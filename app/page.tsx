import DashboardLoader from "@/components/DashboardLoader";

// Halaman dikirim kosong (ringan), lalu data diambil langsung oleh browser dari Supabase.
// Sebelumnya seluruh data (puluhan ribu unit + harga) ditanam di HTML (±50 MB) sehingga website lama terbuka
// dan browser sempat "not responding".
// Tetap dirender per permintaan (tidak dibuat statis saat build).
export const dynamic = "force-dynamic";

export default function Page() {
  return <DashboardLoader />;
}
