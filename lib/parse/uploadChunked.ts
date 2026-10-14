/**
 * Upload Master Part & Actual Sales: file dibaca di browser (lib/parse/uploadClient),
 * lalu dikirim ke server dalam potongan kecil supaya tidak melewati batas ukuran
 * request di Vercel. Mengembalikan { ok, message } seperti uploadFile di UploadModal.
 */
import { parseMasterPartFile, parseActualSalesTxFile, UploadParseError } from "@/lib/parse/uploadClient";

const CHUNK = 2000;

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
