import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Supabase env belum diset. Isi NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_ANON_KEY di .env.local (lihat .env.example)."
  );
}

// Browser client — uses the public anon key only. Row Level Security on the
// database restricts this to read-only access (see supabase/schema.sql).
export const supabaseBrowser = createClient(url, anonKey, {
  auth: { persistSession: false }
});
