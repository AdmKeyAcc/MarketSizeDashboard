import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Akses baca-saja ke database web Sales lewat fungsi `ms_feed` (lihat
 * supabase/sales_db_feed_for_market_size.sql). Hanya dipakai di server.
 *
 * Env (Vercel → project Market Size):
 *   SALES_SUPABASE_URL       URL project Supabase Sales
 *   SALES_SUPABASE_ANON_KEY  anon/publishable key project Sales
 *   SALES_FEED_TOKEN         token dari tabel ms_private.feed_token di DB Sales
 */

export const DEFAULT_EXCLUDED_BRANCHES = ["JKT", "SBY", "SMG", "BDG"];

export type FeedInfo = { min_year: number | null; max_year: number | null; max_date: string | null; rows: number };
export type FeedYearRow = { ka: string; cg: string; cn: string; p: string; amt: number; qty: number };
export type FeedMonthRow = { cg: string; cn: string; p: string; pn: string; pd: string | null; amt: number; qty: number };

let client: SupabaseClient | null = null;

function salesClient(): { client: SupabaseClient; token: string } {
  const url = process.env.SALES_SUPABASE_URL;
  const key = process.env.SALES_SUPABASE_ANON_KEY;
  const token = process.env.SALES_FEED_TOKEN;
  if (!url || !key || !token) {
    throw new Error(
      "Koneksi ke database Sales belum diatur. Isi SALES_SUPABASE_URL, SALES_SUPABASE_ANON_KEY dan SALES_FEED_TOKEN di Vercel → Settings → Environment Variables, lalu redeploy."
    );
  }
  if (!client) client = createClient(url, key, { auth: { persistSession: false } });
  return { client, token };
}

async function feed<T>(kind: "info" | "year" | "month", exclude: string[], year?: number, month?: number): Promise<T> {
  const { client: c, token } = salesClient();
  const { data, error } = await c.rpc("ms_feed", {
    p_token: token,
    p_kind: kind,
    p_year: year ?? null,
    p_month: month ?? null,
    p_exclude: exclude
  });
  if (error) {
    const hint = /token/i.test(error.message)
      ? " (cek SALES_FEED_TOKEN)"
      : /function|does not exist|schema cache/i.test(error.message)
        ? " (jalankan sales_db_feed_for_market_size.sql di Supabase Sales)"
        : "";
    throw new Error(`Gagal membaca data Sales: ${error.message}${hint}`);
  }
  return data as T;
}

export const feedInfo = (exclude: string[]) => feed<FeedInfo>("info", exclude);
export const feedYear = (exclude: string[], year: number) => feed<FeedYearRow[]>("year", exclude, year);
export const feedMonth = (exclude: string[], year: number, month: number) => feed<FeedMonthRow[]>("month", exclude, year, month);
