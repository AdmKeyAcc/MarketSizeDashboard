import "server-only";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Service-role Supabase client. This bypasses Row Level Security, so it must
 * NEVER be imported from client components or exposed to the browser — the
 * `server-only` import above makes Next.js throw a build error if that
 * happens by mistake. Only use this inside app/api/** route handlers.
 */
export function getSupabaseAdmin() {
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase server env belum diset. Isi NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di .env.local / Vercel project settings."
    );
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false }
  });
}
