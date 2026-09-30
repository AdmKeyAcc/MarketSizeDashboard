import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Upserts `rows` in batches — a single request with tens of thousands of
 * rows (uio_units in particular can be that large) risks hitting Supabase's
 * request-size/timeout limits, so this splits the work into chunks of
 * `size` rows each, sequentially.
 */
export async function chunkedUpsert(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  size = 500
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`Upsert ke '${table}' gagal (baris ${i}-${i + chunk.length}): ${error.message}`);
  }
}
