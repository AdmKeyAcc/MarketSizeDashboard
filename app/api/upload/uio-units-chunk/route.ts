import { authUpload, logUpload, normBranch } from "@/lib/uploadAuth";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { uioSerialKey } from "@/lib/uioKey";
import { PRICE_TYPE_LABEL, normPriceType } from "@/lib/priceType";

export const runtime = "nodejs";
export const maxDuration = 60;

type Row = {
  year?: unknown; product?: unknown; model?: unknown; customer_group?: unknown; customer_name?: unknown; branch?: unknown;
  serial_number?: unknown; pss_name?: unknown; customer_code?: unknown; customer_type?: unknown;
  hm_day?: unknown; day_month?: unknown; month_year?: unknown; month_inv?: unknown; price_type?: unknown; engine_number?: unknown;
};
type Body = {
  action?: "start" | "rows" | "finish";
  rows?: Row[];
  filename?: string;
  total?: number;
  sheet?: string;
  replace?: boolean;
  /** "merge" = tambah / perbarui per Serial Number; "replace" = ganti semua (keduanya admin);
   *  "branch_add" = cabang menambah unit baru (unit yang sudah ada tidak diubah). */
  mode?: "replace" | "merge" | "branch_add";
  /** Identitas pengupload — dicek di SETIAP request (lib/uploadAuth). */
  auth?: Record<string, unknown>;
  /** Ringkasan dari browser untuk catatan upload (action finish). */
  summary?: { saved?: number; rejected?: number; note?: string };
  /** Cap waktu upload dari action "start" (dipakai semua potongan). */
  since?: string;
};
const s = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
};
const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

/** Serial Number valid = kunci satu unit fisik; tanpa serial valid dapat kunci acak (selalu baris baru). */
function dedupeKey(product: string | null, serial: string | null, model: string | null): string {
  return uioSerialKey(product, serial, model) ?? `no-serial::${randomUUID()}`;
}

/** Engine Number dinormalkan (huruf besar, tanpa spasi); kosong / placeholder / < 3 karakter → null. */
function engineKey(v: unknown): string | null {
  const t = String(v ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (t.length < 3 || ["-", "N/A", "NA", "NAN", "NONE", "#N/A", "TIDAKADA"].includes(t)) return null;
  return t;
}

/**
 * Upload Data UIO bertahap (file dibaca di browser, dikirim per potongan supaya tidak kena batas ukuran request Vercel).
 * Hak akses (dicek di server untuk setiap potongan):
 *   - admin (PIN): merge = tambah / perbarui, replace = ganti semua.
 *   - cabang (kode akses): selalu branch_add — hanya unit BARU untuk cabangnya sendiri, wajib Serial Number;
 *     unit yang sudah ada di database (Product + Model + Serial Number sama) tidak diubah.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();

    // Cap waktu satu upload; semua potongan menyimpan uploaded_at = cap ini.
    const sinceOk = body.since && !Number.isNaN(Date.parse(String(body.since))) ? String(body.since) : null;

    const a = await authUpload(body.auth, true);
    if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
    const who = a.who;
    // Cabang selalu mode branch_add, apa pun yang dikirim browser. Admin: merge / replace.
    const mode: "merge" | "replace" | "branch_add" =
      who.role === "branch" ? "branch_add" : body.mode === "replace" || (body.mode === undefined && body.replace) ? "replace" : "merge";

    if (body.action === "start") {
      // Tidak menghapus apa pun di awal: mode ganti semua menghapus data lama SETELAH semua unit baru tersimpan.
      return NextResponse.json({ ok: true, since: now });
    }

    if (body.action === "finish") {
      let removed = 0;
      if (mode === "replace") {
        if (!sinceOk) return NextResponse.json({ error: "Waktu mulai upload tidak valid — ulangi upload." }, { status: 400 });
        const d1 = await supabase.from("uio_units").delete({ count: "exact" }).lt("uploaded_at", sinceOk);
        if (d1.error) throw d1.error;
        const d2 = await supabase.from("uio_units").delete({ count: "exact" }).is("uploaded_at", null);
        if (d2.error) throw d2.error;
        removed = (d1.count ?? 0) + (d2.count ?? 0);
      }
      // Jumlah unit di database (mode tambah/perbarui: bukan jumlah baris file).
      const cnt = await supabase.from("uio_units").select("id", { count: "exact", head: true });
      const fname = s(body.filename) || "Data UIO";
      const up = await supabase.from("app_meta").upsert({
        key: "uio_units",
        value: {
          filename: who.role === "branch" ? `${who.branch}: ${fname}` : fname,
          row_count: cnt.error ? Number(body.total) || 0 : cnt.count ?? 0,
          uploaded_rows: Number(body.total) || 0,
          mode,
          sheet: s(body.sheet)
        },
        updated_at: now
      });
      if (up.error) throw up.error;
      await logUpload({
        who,
        kind: "uio",
        mode,
        filename: fname,
        rows_sent: Number(body.total) || 0,
        rows_saved: typeof body.summary?.saved === "number" ? body.summary.saved : null,
        rows_rejected: typeof body.summary?.rejected === "number" ? body.summary.rejected : null,
        note: [body.summary?.note, removed ? `${removed} unit lama dihapus` : ""].filter(Boolean).join(" · ") || null
      });
      return NextResponse.json({ ok: true, removed, rowCount: cnt.error ? null : cnt.count ?? null });
    }

    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) return NextResponse.json({ error: "Tidak ada baris yang dikirim." }, { status: 400 });
    if (rows.length > 5000) return NextResponse.json({ error: "Potongan data terlalu besar." }, { status: 413 });

    // Dalam satu potongan, key yang sama tidak boleh muncul dua kali (upsert menolaknya): ambil yang terakhir.
    const byKey = new Map<string, Record<string, unknown>>();
    const rejected = { otherBranch: 0, noSerial: 0, exists: 0 };
    rows.forEach((r) => {
      const product = s(r.product)?.toUpperCase() ?? null;
      if (!product) return;
      const serial = s(r.serial_number);
      const model = s(r.model);
      const validKey = uioSerialKey(product, serial, model);
      // Tambah/perbarui & cabang: unit tanpa Serial Number valid tidak bisa dicocokkan → tidak disimpan (mencegah data ganda).
      if (mode !== "replace" && !validKey) {
        rejected.noSerial++;
        return;
      }
      // Cabang hanya boleh unit cabangnya sendiri (Branch kosong = cabang pengupload).
      let branch = s(r.branch);
      if (who.role === "branch") {
        if (branch && normBranch(branch) !== who.branch) {
          rejected.otherBranch++;
          return;
        }
        branch = who.branch;
      }
      const key = validKey ?? dedupeKey(product, serial, model);
      byKey.set(key, {
        dedupe_key: key,
        year: n(r.year),
        month_inv: (() => {
          const m = n(r.month_inv);
          return m !== null && Number.isInteger(m) && m >= 1 && m <= 12 ? m : null;
        })(),
        product,
        model: s(r.model),
        customer_group: s(r.customer_group),
        customer_name: s(r.customer_name),
        branch,
        serial_number: serial,
        engine_number: engineKey(r.engine_number),
        pss_name: s(r.pss_name),
        customer_code: s(r.customer_code),
        customer_type: s(r.customer_type),
        hm_day: n(r.hm_day),
        day_month: n(r.day_month),
        month_year: n(r.month_year),
        price_type: (() => {
          const t = normPriceType(r.price_type);
          return t ? PRICE_TYPE_LABEL[t] : null;
        })(),
        source_filename: s(body.filename),
        uploaded_at: sinceOk ?? now
      });
    });
    const clean = Array.from(byKey.values());
    const strip = (xs: Record<string, unknown>[], cols: string[]) => xs.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !cols.includes(k))));
    let saved = 0;
    if (clean.length > 0) {
      const drop: string[] = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        const payload = strip(clean, drop);
        // Cabang: hanya MENAMBAH — Serial Number yang sudah ada dibiarkan (ignoreDuplicates), tidak ditimpa.
        const up =
          mode === "branch_add"
            ? await supabase.from("uio_units").upsert(payload, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id")
            : await supabase.from("uio_units").upsert(payload, { onConflict: "dedupe_key" });
        if (!up.error) {
          saved = mode === "branch_add" ? (up.data || []).length : payload.length;
          break;
        }
        // Kolom baru belum ada (migration v24 / v28 belum dijalankan) → simpan tanpa kolom itu.
        const miss = ["price_type", "engine_number"].find((c) => !drop.includes(c) && new RegExp(c, "i").test(up.error.message || ""));
        if (!miss) throw up.error;
        drop.push(miss);
      }
      if (mode === "branch_add") rejected.exists += clean.length - saved;
    }
    return NextResponse.json({ ok: true, count: saved, rejected });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Gagal memproses data." }, { status: 500 });
  }
}
