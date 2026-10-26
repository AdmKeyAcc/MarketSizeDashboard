/**
 * Upload Master Part & Actual Sales: file dibaca di browser (lib/parse/uploadClient),
 * lalu dikirim ke server dalam potongan kecil supaya tidak melewati batas ukuran
 * request di Vercel. Mengembalikan { ok, message } seperti uploadFile di UploadModal.
 */
import { parseMasterPartFile, parseActualSalesTxFile, parseActualSalesYearFile, UploadParseError } from "@/lib/parse/uploadClient";

const CHUNK = 2000;
/** Data UIO dibaca mulai tahun ini saja (populasi sebelum 2018 diabaikan). */
const UIO_MIN_YEAR = 2018;

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

export async function uploadMasterPart(file: File, onProgress?: (text: string) => void): Promise<Result> {
  try {
    onProgress?.("Membaca file…");
    const parsed = await parseMasterPartFile(file);
    const url = "/api/upload/master-part";
    for (let i = 0; i < parsed.rows.length; i += CHUNK) {
      onProgress?.(`Mengirim ${Math.min(i + CHUNK, parsed.rows.length).toLocaleString("id-ID")} / ${parsed.rows.length.toLocaleString("id-ID")} baris…`);
      await post(url, {
        action: "rows",
        rows: parsed.rows.slice(i, i + CHUNK),
        hasHmDay: parsed.hasHmDay,
        hasComponent: parsed.hasComponent,
        filename: file.name
      });
    }
    await post(url, { action: "finish", filename: file.name, total: parsed.rows.length });
    return { ok: true, message: { rowCount: parsed.rows.length, skipped: parsed.skipped, duplicates: parsed.duplicates, sheet: parsed.sheet } };
  } catch (err) {
    return { ok: false, message: errMessage(err) };
  }
}

export async function uploadActualSales(file: File, onProgress?: (text: string) => void): Promise<Result> {
  try {
    onProgress?.("Membaca file…");
    const parsed = await parseActualSalesTxFile(file);
    const url = "/api/upload/actual-sales-tx";
    await post(url, { action: "start", periods: parsed.periods });
    for (let i = 0; i < parsed.rows.length; i += CHUNK) {
      onProgress?.(`Mengirim ${Math.min(i + CHUNK, parsed.rows.length).toLocaleString("id-ID")} / ${parsed.rows.length.toLocaleString("id-ID")} baris…`);
      await post(url, { action: "rows", rows: parsed.rows.slice(i, i + CHUNK), filename: file.name });
    }
    await post(url, { action: "finish", filename: file.name, total: parsed.rows.length });
    return {
      ok: true,
      message: { rowCount: parsed.rows.length, skipped: parsed.skipped, periods: parsed.periods.length, sheet: parsed.sheet }
    };
  } catch (err) {
    return { ok: false, message: errMessage(err) };
  }
}

export async function uploadActualSalesYear(
  file: File,
  onProgress?: (text: string) => void
): Promise<Result> {
  try {
    onProgress?.("Membaca file…");
    const parsed = await parseActualSalesYearFile(file);
    if (parsed.kind === "product") {
      // Laporan per Product tidak punya KA Type: isi dari Master Customer (customers.tier) per Customer Group + Customer.
      onProgress?.("Mengisi KA Type dari Master Customer…");
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
    await post(url, { action: "start", years: parsed.years });
    for (let i = 0; i < parsed.rows.length; i += CHUNK) {
      onProgress?.(`Mengirim ${Math.min(i + CHUNK, parsed.rows.length).toLocaleString("id-ID")} / ${parsed.rows.length.toLocaleString("id-ID")} baris…`);
      await post(url, { action: "rows", rows: parsed.rows.slice(i, i + CHUNK), filename: file.name });
    }
    await post(url, { action: "finish", filename: file.name, total: parsed.rows.length, ytdYear: latestYear, ytdMonth });
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
 * Upload Data UIO: file dibaca di browser (bisa puluhan ribu baris / belasan MB, melewati batas request Vercel),
 * nama customer disamakan dengan Master Customer, lalu dikirim per potongan. Mengganti seluruh isi Data UIO.
 */
export async function uploadUioUnits(file: File, onProgress?: (text: string) => void): Promise<Result> {
  try {
    onProgress?.("Membaca file (bisa beberapa puluh detik)…");
    const XLSX = await import("@e965/xlsx");
    const { parseUioUnitsWorkbook, canonicalizeUnits } = await import("@/lib/parse/uioUnits");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const parsed = parseUioUnitsWorkbook(wb, { minYear: UIO_MIN_YEAR });

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

    const url = "/api/upload/uio-units-chunk";
    await post(url, { action: "start", replace: true });
    for (let i = 0; i < mapped.rows.length; i += CHUNK) {
      onProgress?.(`Mengirim ${Math.min(i + CHUNK, mapped.rows.length).toLocaleString("id-ID")} / ${mapped.rows.length.toLocaleString("id-ID")} unit…`);
      await post(url, { action: "rows", rows: mapped.rows.slice(i, i + CHUNK), filename: file.name });
    }
    await post(url, { action: "finish", filename: file.name, total: mapped.rows.length, sheet: parsed.sheetName });
    return {
      ok: true,
      message: {
        rowCount: mapped.rows.length,
        skipped: parsed.skipped,
        returns: parsed.returns,
        beforeMinYear: parsed.beforeMinYear,
        minYear: UIO_MIN_YEAR,
        sheet: parsed.sheetName,
        exact: mapped.exact,
        remapped: mapped.remapped,
        unmatched: mapped.unmatched
      }
    };
  } catch (err) {
    return { ok: false, message: errMessage(err) };
  }
}
