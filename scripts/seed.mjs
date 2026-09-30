// One-time setup script — run this ONCE against a fresh Supabase project
// (after applying supabase/schema.sql) to load the bundled sample data, so
// the dashboard has something to show before you upload your own files.
//
// Usage:
//   node --env-file=.env.local scripts/seed.mjs
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the env.
// Safe to re-run: it replaces (parts/uio_master/customers) or upserts
// (actual_sales/assumptions) the same way the app's own upload routes do.

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data", "sample");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error(
    "Env belum diset. Jalankan dengan: node --env-file=.env.local scripts/seed.mjs\n" +
      "(butuh NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY)"
  );
  process.exit(1);
}
const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

async function loadJson(name) {
  const raw = await readFile(path.join(dataDir, name), "utf-8");
  return JSON.parse(raw);
}

async function chunkedInsert(table, rows, size = 500) {
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const { error } = await supabase.from(table).insert(chunk);
    if (error) throw new Error(`Insert ke '${table}' gagal: ${error.message}`);
  }
}

async function main() {
  console.log("Membaca data contoh dari data/sample/ ...");
  const parts = await loadJson("parts.json");
  const uio = await loadJson("uio_master.json");
  const assumptions = await loadJson("assumptions.json");
  const customers = await loadJson("customers.json");
  const actualSales = await loadJson("actual_sales.json");

  console.log("Menghapus data lama (jika ada) ...");
  for (const table of ["parts", "uio_master", "customers"]) {
    const { error } = await supabase.from(table).delete().gte("id", 0);
    if (error) throw new Error(`Gagal menghapus '${table}': ${error.message}`);
  }

  console.log(`Mengisi parts (${parts.length} baris) ...`);
  await chunkedInsert("parts", parts);
  console.log(`Mengisi uio_master (${uio.length} baris) ...`);
  await chunkedInsert("uio_master", uio);
  console.log(`Mengisi customers (${customers.length} baris) ...`);
  await chunkedInsert("customers", customers);

  console.log(`Mengisi assumptions (${assumptions.length} brand) ...`);
  {
    const { error } = await supabase
      .from("assumptions")
      .upsert(assumptions.map((a) => ({ ...a, updated_at: new Date().toISOString() })), {
        onConflict: "product"
      });
    if (error) throw new Error(`Upsert assumptions gagal: ${error.message}`);
  }

  console.log(`Mengisi actual_sales (${actualSales.length} baris, data contoh/simulasi) ...`);
  {
    const { error } = await supabase
      .from("actual_sales")
      .upsert(actualSales.map((a) => ({ ...a, updated_at: new Date().toISOString() })), {
        onConflict: "year,month,product"
      });
    if (error) throw new Error(`Upsert actual_sales gagal: ${error.message}`);
  }

  const now = new Date().toISOString();
  await supabase.from("app_meta").upsert([
    { key: "kalkulator", value: { filename: "contoh bawaan (seed)", row_count: parts.length }, updated_at: now },
    { key: "customers", value: { filename: "contoh bawaan (seed)", row_count: customers.length }, updated_at: now },
    { key: "actual_sales", value: { filename: "contoh bawaan (seed)", row_count: actualSales.length }, updated_at: now }
  ]);

  console.log("Selesai. Data contoh sudah masuk ke Supabase.");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
