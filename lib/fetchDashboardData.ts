import { createClient } from "@supabase/supabase-js";
import { fetchDashboardDataWithClient } from "@/lib/fetchDashboardDataShared";
import type { DashboardData } from "@/lib/types";

export async function fetchDashboardData(): Promise<DashboardData> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase env belum diset. Isi NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_ANON_KEY di .env.local."
    );
  }
  // Public anon key — RLS only allows SELECT, so this is safe server-side too.
  const supabase = createClient(url, anonKey, { auth: { persistSession: false } });
  return fetchDashboardDataWithClient(supabase);
}
