"use client";

import { useEffect, useState } from "react";
import Dashboard from "@/components/Dashboard";
import { fetchDashboardDataWithClient } from "@/lib/fetchDashboardDataShared";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { DashboardData } from "@/lib/types";

/** Mengambil data dashboard di browser (setelah halaman tampil), dengan tampilan memuat & tombol coba lagi. */
export default function DashboardLoader() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSecs(0);
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    fetchDashboardDataWithClient(supabaseBrowser)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError((e as Error).message || "Gagal memuat data."))
      .finally(() => clearInterval(t));
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [attempt]);

  if (data) return <Dashboard initialData={data} />;
  return (
    <div className="app">
      <div className="loading-screen">
        <div className="loading-title">Market Size RPL</div>
        {error ? (
          <>
            <div className="loading-error">Gagal memuat data: {error}</div>
            <button type="button" className="btn" onClick={() => setAttempt((a) => a + 1)}>
              Coba lagi
            </button>
          </>
        ) : (
          <>
            <span className="spinner" aria-label="Memuat" />
            <div className="loading-sub">Memuat data UIO, harga & Actual Sales… {secs > 0 ? `${secs} detik` : ""}</div>
          </>
        )}
      </div>
    </div>
  );
}
