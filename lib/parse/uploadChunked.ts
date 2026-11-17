/**
 * Upload Master Part & Actual Sales: file dibaca di browser (lib/parse/uploadClient),
 * lalu dikirim ke server dalam potongan kecil supaya tidak melewati batas ukuran
 * request di Vercel. Mengembalikan { ok, message } seperti uploadFile di UploadModal.
 */
import { parseMasterPartFile, parseActualSalesYearFile, UploadParseError } from "@/lib/parse/uploadClient";

const CHUNK = 2000;
import { uioMinYear } from "@/lib/calculations";
import type { UploadAuth } from "@/lib/uploadAuthClient";

type Result = { ok: boolean; message: any };

async function post(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Gagal (${res.status}).`);
  return json;
}

function errMessage(err: unknown): string {
  if (err instanceof UploadParseError) return err.message;
  return (err as Error)?.message || "Gagal memproses file.";
}

export async function uploadMasterPart(file: File, onProgress?: (text: string) => void, mode: "merge" | "replace" = "merge", pin = ""): Promise<Result> {
  try {
    onProgress?.("Membaca file…");
    const parsed = await parseMasterPartFile(file);
    const url = "/api/upload/master-part";
    // Ringkasan diperbarui / baru: bandingkan dengan Master Part yang sudah ada.
    onProgress?.("Membandingkan dengan Master Part yang sudah ada…");
    const { supabaseBrowser } = await import("@/lib/supabase/client");
    const k = (p: string | null, m: string | null, n: string | null) => `${String(p ?? "").trim().toUpperCase()}|${String(m ?? "").trim()}|${String(n ?? "").trim()}`;
    const existing = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabaseBrowser.from("parts").select("product, model, part_number").order("id").range(from, from + 999);
      if (error) throw new Error("Gagal membaca Master Part: " + error.message);
      (data || []).forEach((r: { product: string | null; model: string | null; part_number: string | null }) => existing.add(k(r.product, r.model, r.part_number)));
      if (!data || data.length < 1000) break;
    }
    const updated = parsed.rows.filter((r) => existing.has(k(r.product, r.model, r.part_number))).length;
    const { since } = await post(url, { action: "start", mode, pin });
    for (let i = 0; i < parsed.rows.length; i += CHUNK) {
      onProgress?.(`Mengirim ${Math.min(i + CHUNK, parsed.rows.length).toLocaleString("id-ID")} / ${parsed.rows.length.toLocaleString("id-ID")} baris…`);
      await post(url, {
        action: "rows",
        rows: parsed.rows.slice(i, i + CHUNK),
        hasHmDay: parsed.hasHmDay,
        hasComponent: parsed.hasComponent,
        filename: file.name,
        since,
        pin
      });
    }
    const fin = await post(url, { action: "finish", filename: file.name, total: parsed.rows.length, mode, since, pin });
    return {
      ok: true,
      message: {
        rowCount: parsed.rows.length,
        skipped: parsed.skipped,
        duplicates: parsed.duplicates,
        sheet: parsed.sheet,
        mode,
        updated,
        added: parsed.rows.length - updated,
        removed: fin?.removed ?? 0,
        totalInDb: fin?.totalInDb ?? null
      }
    };
  } catch (err) {
    return { ok: false, message: errMessage(err) };
  }
}

export async function uploadActualSalesYear(
  file: File,
  onProgress?: (text: string) => void,
  pin = ""
): Promise<Result> {
  try {
    onProgress?.("Membaca file…");
    const parsed = await parseActualSalesYearFile(file);
    if (parsed.kind === "product") {
      // Laporan per Product tidak punya Customer Type: isi dari Master Customer (customers.tier) per Customer Group + Customer.
      onProgress?.("Mengisi Customer Type dari Master Customer…");
      const { supabaseBrowser } = await import("@/lib/supabase/client");
      const tierOf = new Map<string, string>();
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabaseBrowser.from("customers").select("customer_group, customer_name, tier").range(from, from + 999);
        if (error) throw new Error("Gagal membaca Master Customer: " + error.message);
        (data || []).forEach((c: { customer_group: string | null; customer_name: string | null; tier: string | null }) => {
          if (c.tier) tierOf.set(`${(c.customer_group || "").trim().toUpperCase()}|${(c.customer_name || "").trim().toUpperCase()}`, c.tier.trim().toUpperCase());
        });
        if (!data || data.length < 1000) break;
      }
      parsed.rows.forEach((r) => {
        r.ka_type = tierOf.get(`${r.customer_group.trim().toUpperCase()}|${r.customer_name.trim().toUpperCase()}`) || "";
      });
    }
    const url = "/api/upload/actual-sales-year";
    const latestYear = Math.max(...parsed.years);
    // Bulan data tahun terbaru dibaca otomatis: tanggal di nama file (mis. Laporan_Sales_2026-10-20.xlsx), kalau tidak ada pakai tanggal hari ini.
    const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    const dm = /(\d{4})[-_.](\d{2})[-_.](\d{2})/.exec(file.name);
    const ref = dm ? { y: Number(dm[1]), m: Number(dm[2]) - 1 } : { y: new Date().getFullYear(), m: new Date().getMonth() };
    const ytdMonth = latestYear < ref.y ? "Desember" : BULAN[Math.min(Math.max(ref.m, 0), 11)];
    await post(url, { action: "start", years: parsed.years, pin });
    for (let i = 0; i < parsed.rows.length; i += CHUNK) {
      onProgress?.(`Mengirim ${Math.min(i + CHUNK, parsed.rows.length).toLocaleString("id-ID")} / ${parsed.rows.length.toLocaleString("id-ID")} baris…`);
      await post(url, { action: "rows", rows: parsed.rows.slice(i, i + CHUNK), filename: file.name, pin });
    }
    await post(url, { action: "finish", filename: file.name, total: parsed.rows.length, ytdYear: latestYear, ytdMonth, pin });
    return {
      ok: true,
      message: {
        rowCount: parsed.rows.length,
        groups: parsed.groups,
        customers: parsed.customers,
        kind: parsed.kind,
        products: parsed.products,
        years: parsed.years,
        latestYear,
        ytdMonth,
        totalDiff: parsed.totalDiff
      }
    };
  } catch (err) {
    return { ok: false, message: errMessage(err) };
  }
}

/**
 * Data UIO, langkah 1: baca & periksa file di browser (belum menyimpan apa pun).
 * Hasilnya berisi ringkasan pemeriksaan (kolom/isi kosong atau tidak valid) untuk ditampilkan
 * ke pengguna, dan fungsi `commit` untuk benar-benar menyimpan kalau pengguna melanjutkan.
 *
 * Mode:
 *   merge      (admin)  tambah / perbarui per Product + Serial Number
 *   replace    (admin)  ganti semua
 *   branch_add (cabang) hanya MENAMBAH unit baru untuk cabangnya sendiri; unit yang sudah ada tidak diubah
 */
export type UioUploadMode = "replace" | "merge" | "branch_add";
export type UioPrepared = {
  validation: import("@/lib/parse/uioUnits").UioValidation;
  /** Jumlah unit yang akan disimpan. */
  rowCount: number;
  sheet: string;
  /** Sheet lain di file yang juga berisi tabel unit (untuk dipilih). */
  sheets: { name: string; rows: number }[];
  mode: UioUploadMode;
  /** Perbandingan dengan isi database (mode merge / branch_add). */
  merge?: {
    updated: number;
    added: number;
    noSerial: number;
    existing: number;
    /** Cabang: baris cabang lain / unit yang sudah ada (tidak diubah). */
    otherBranch?: number;
    exists?: number;
    branch?: string;
  };
  commit: (onProgress?: (text: string) => void) => Promise<Result>;
};

/** Unit yang sudah ada di database: kunci Product + Model + Serial Number (lib/uioKey), dihitung ulang dari kolomnya
 * (bukan dari dedupe_key lama) supaya tetap benar walau data lama di-upload dengan aturan kunci sebelumnya.
 * Diambil per rentang id (fetchAll) supaya tidak kena "statement timeout" di tabel besar. */
async function existingUio(): Promise<{ keys: Set<string> }> {
  const { supabaseBrowser } = await import("@/lib/supabase/client");
  const { fetchAll } = await import("@/lib/fetchDashboardDataShared");
  const { uioSerialKey } = await import("@/lib/uioKey");
  type R = { id: number; product: string | null; model: string | null; serial_number: string | null };
  let rows: R[];
  try {
    rows = await fetchAll<R>(supabaseBrowser, "uio_units", "id", "id, product, model, serial_number");
  } catch (err) {
    throw new Error("Gagal membaca Data UIO yang sudah ada: " + (err as Error).message);
  }
  const keys = new Set<string>();
  rows.forEach((r) => {
    const k = uioSerialKey(r.product, r.serial_number, r.model);
    if (k) keys.add(k);
  });
  return { keys };
}

export async function prepareUioUpload(
  file: File,
  mode: UioUploadMode = "merge",
  sheet: string | undefined,
  known: import("@/lib/parse/uioUnits").UioKnown | undefined,
  auth: UploadAuth
): Promise<{ ok: true; prep: UioPrepared } | { ok: false; message: string }> {
  try {
    if (auth.role === "branch") mode = "branch_add";
    else if (mode === "branch_add") mode = "merge";
    const XLSX = await import("@e965/xlsx");
    const { parseUioUnitsWorkbook, canonicalizeUnits } = await import("@/lib/parse/uioUnits");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const parsed = parseUioUnitsWorkbook(wb, { minYear: uioMinYear(), sheet, known });
    const { uioSerialKey } = await import("@/lib/uioKey");
    const issues = parsed.validation.issues;
    /** Tambah satu baris ringkasan pemeriksaan (dengan nomor baris Excel). */
    const addIssue = (level: "penting" | "info", field: string, message: string, rowsNo: number[]) => {
      if (rowsNo.length === 0) return;
      issues.unshift({ field, level, message, count: rowsNo.length, rows: rowsNo.slice(0, 15) });
    };

    let merge: UioPrepared["merge"];
    if (mode !== "replace") {
      const { keys: existing } = await existingUio();
      const seen = new Set<string>();
      let updated = 0, added = 0;
      const noSerialRows: number[] = [], otherRows: number[] = [], existRows: number[] = [];
      const own = auth.role === "branch" ? auth.branch.trim().toUpperCase() : "";
      const keep = parsed.rows.filter((r) => {
        const k = uioSerialKey(r.product, r.serial_number, r.model);
        if (!k) {
          noSerialRows.push(r.row_no ?? 0);
          return false;
        }
        if (own) {
          const b = String(r.branch ?? "").trim().toUpperCase();
          if (b && b !== own) {
            otherRows.push(r.row_no ?? 0);
            return false;
          }
          r.branch = own;
          if (existing.has(k)) {
            existRows.push(r.row_no ?? 0);
            return false;
          }
        }
        if (!seen.has(k)) {
          seen.add(k);
          if (existing.has(k)) updated++;
          else added++;
        }
        return true;
      });
      parsed.rows = keep;
      if (own) {
        addIssue("penting", "Serial Number", "Unit (Product + Model + Serial Number) sudah ada di database — unit yang sudah ada tidak bisa diubah dari akun cabang, baris tidak disimpan. Hubungi admin untuk mengubahnya", existRows);
        addIssue("penting", "Branch", `Branch bukan ${own} — akun cabang hanya bisa menambah unit cabangnya sendiri, baris tidak disimpan`, otherRows);
      }
      addIssue("penting", "Serial Number", "Serial Number kosong — tidak bisa dicek dobel, baris tidak disimpan (mode ini wajib Serial Number)", noSerialRows);
      merge = {
        updated,
        added,
        noSerial: noSerialRows.length,
        existing: existing.size,
        otherBranch: otherRows.length,
        exists: existRows.length,
        branch: own || undefined
      };
      if (keep.length === 0) {
        return {
          ok: false,
          message: own
            ? `Tidak ada unit baru yang bisa disimpan untuk cabang ${own}: ${noSerialRows.length} baris tanpa Serial Number, ${otherRows.length} baris cabang lain, ${existRows.length} unit sudah ada.`
            : `Tidak ada unit dengan Serial Number yang bisa dicocokkan (${noSerialRows.length} baris tanpa Serial Number). Mode tambah/perbarui butuh Serial Number.`
        };
      }
    }

    const commit = async (onProgress?: (text: string) => void): Promise<Result> => {
      try {
        onProgress?.("Menyamakan nama customer dengan Master Customer…");
        const { supabaseBrowser } = await import("@/lib/supabase/client");
        const canon: { customer_group: string | null; customer_name: string | null }[] = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabaseBrowser.from("customers").select("customer_group, customer_name").range(from, from + 999);
          if (error) throw new Error("Gagal membaca Master Customer: " + error.message);
          canon.push(...(data || []));
          if (!data || data.length < 1000) break;
        }
        const mapped = canonicalizeUnits(parsed.rows, canon);
        const send = mapped.rows.map(({ row_no: _r, ...x }) => x);

        const url = "/api/upload/uio-units-chunk";
        const { since } = await post(url, { action: "start", mode, auth });
        let saved = 0;
        const rej = { otherBranch: 0, noSerial: 0, exists: 0 };
        for (let i = 0; i < send.length; i += CHUNK) {
          onProgress?.(`Mengirim ${Math.min(i + CHUNK, send.length).toLocaleString("id-ID")} / ${send.length.toLocaleString("id-ID")} unit…`);
          const j = await post(url, { action: "rows", rows: send.slice(i, i + CHUNK), filename: file.name, mode, since, auth });
          saved += Number(j.count) || 0;
          (Object.keys(rej) as (keyof typeof rej)[]).forEach((k) => (rej[k] += Number(j.rejected?.[k]) || 0));
        }
        const before = parsed.validation.totalRows;
        const rejected = before - saved;
        const fin = await post(url, {
          action: "finish",
          filename: file.name,
          total: send.length,
          sheet: parsed.sheetName,
          mode,
          since,
          auth,
          summary: {
            saved,
            rejected: Math.max(0, rejected),
            note: merge
              ? [
                  merge.noSerial + rej.noSerial ? `${merge.noSerial + rej.noSerial} tanpa Serial Number` : "",
                  (merge.otherBranch ?? 0) + rej.otherBranch ? `${(merge.otherBranch ?? 0) + rej.otherBranch} cabang lain` : "",
                  (merge.exists ?? 0) + rej.exists ? `${(merge.exists ?? 0) + rej.exists} sudah ada` : ""
                ].filter(Boolean).join(", ")
              : ""
          }
        });
        return {
          ok: true,
          message: {
            rowCount: saved,
            skipped: parsed.skipped,
            returns: parsed.returns,
            beforeMinYear: parsed.beforeMinYear,
            minYear: uioMinYear(),
            sheet: parsed.sheetName,
            exact: mapped.exact,
            remapped: mapped.remapped,
            unmatched: mapped.unmatched,
            mode,
            merge,
            serverRejected: rej,
            totalInDb: fin?.rowCount ?? null,
            removed: fin?.removed ?? 0
          }
        };
      } catch (err) {
        return { ok: false, message: errMessage(err) };
      }
    };
    return { ok: true, prep: { validation: parsed.validation, rowCount: parsed.rows.length, sheet: parsed.sheetName, sheets: parsed.sheets, mode, merge, commit } };
  } catch (err) {
    return { ok: false, message: errMessage(err) };
  }
}

/** Data UIO tanpa jeda pemeriksaan (baca + simpan sekaligus). Mengganti seluruh Data UIO. */
export async function uploadUioUnits(file: File, auth: UploadAuth, onProgress?: (text: string) => void): Promise<Result> {
  onProgress?.("Membaca file (bisa beberapa puluh detik)…");
  const r = await prepareUioUpload(file, "replace", undefined, undefined, auth);
  if (!r.ok) return { ok: false, message: r.message };
  return r.prep.commit(onProgress);
}

/**
 * Upload Data Harga (Kontrak/SCPL atau Non Kontrak) bertahap: file dibaca di browser, lalu dikirim per potongan
 * ke /api/upload/price-chunk. File harga puluhan ribu baris tidak lagi kena batas 60 detik Vercel.
 * Hasil `message` sama dengan route lama (rowCount, skipped, duplicates, noCode, scpl, updated, added, removed).
 */
export async function uploadPricesChunked(
  kind: "contract" | "non_contract",
  file: File,
  mode: "merge" | "replace" = "merge",
  pin = "",
  onProgress?: (text: string) => void
): Promise<Result> {
  const url = "/api/upload/price-chunk";
  try {
    onProgress?.("Membaca file…");
    const XLSX = await import("@e965/xlsx");
    const { parseContractPriceWorkbook, parseNonContractPriceWorkbook } = await import("@/lib/parse/priceList");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const start = await post(url, { action: "start", kind, mode, pin });
    const since: string = start.since;
    const discount: number = typeof start.discount === "number" ? start.discount : 0.5;

    let rows: Record<string, unknown>[] = [];
    const info: Record<string, unknown> = {};
    if (kind === "contract") {
      const r = parseContractPriceWorkbook(wb);
      rows = r.rows.map((x) => ({ part_number: x.part_number, customer_group: x.customer_group, customer_code: x.customer_code, customer_name: x.customer_name, customer_type: x.customer_type, price: x.price, list_price: null, price_type: x.price_type }));
      Object.assign(info, { skipped: r.skipped, duplicates: r.duplicates, nonContractRows: r.nonContractRows, noCode: r.noCode, scpl: r.rows.filter((x) => x.price_type === "scpl").length });
    } else {
      const r = parseNonContractPriceWorkbook(wb, discount);
      rows = r.rows.map((x) => ({ part_number: x.part_number, customer_group: "", customer_code: "", price: x.price, list_price: x.list_price }));
      Object.assign(info, { skipped: r.skipped, duplicates: r.duplicates, discount });
    }
    if (rows.length === 0) throw new Error("Tidak ada baris harga yang bisa dibaca dari file.");

    for (let i = 0; i < rows.length; i += CHUNK) {
      onProgress?.(`Menyimpan harga ${Math.min(i + CHUNK, rows.length).toLocaleString("id-ID")} / ${rows.length.toLocaleString("id-ID")}…`);
      await post(url, { action: "rows", kind, mode, since, pin, filename: file.name, rows: rows.slice(i, i + CHUNK) });
    }
    onProgress?.(mode === "replace" ? "Menghapus harga lama…" : "Menyelesaikan…");
    const fin = await post(url, { action: "finish", kind, mode, pin, since, filename: file.name, rowCount: rows.length, discount });
    const added = Math.max(0, (fin.afterUpsert ?? 0) - (start.before ?? 0));
    return {
      ok: true,
      message: { ok: true, rowCount: rows.length, mode, ...info, added, updated: Math.max(0, rows.length - added), removed: fin.removed ?? 0, totalInDb: fin.totalInDb }
    };
  } catch (err) {
    return { ok: false, message: errMessage(err) };
  }
}
