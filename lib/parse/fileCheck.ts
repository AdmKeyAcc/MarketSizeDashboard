/**
 * Pemeriksaan file upload SEBELUM data disimpan (Data Harga Kontrak / SCPL, Harga Non Kontrak, Master Part).
 * Hasilnya ditampilkan di modal Upload: daftar masalah (baris dobel, harga berbeda untuk customer + part yang sama,
 * kolom wajib kosong, dll.), lalu pengguna memilih "Lanjutkan upload" atau "Perbaiki file".
 * Data UIO punya pemeriksaan sendiri (lib/parse/uioUnits.ts) dengan bentuk hasil yang sama.
 */
import type { UioIssue, UioValidation } from "@/lib/parse/uioUnits";
import { parsePrice } from "@/lib/parse/priceList";
import { normCode, normPriceType } from "@/lib/priceType";
import { canonicalProduct } from "@/lib/calculations";
import type { TemplateLists } from "@/lib/downloadTemplates";
import { loose, makeMatcher } from "@/lib/fuzzy";

export type CheckKind = "contract" | "non_contract" | "parts";
export type FileCheck = UioValidation & {
  sheet: string;
  /** Baris yang akan disimpan (setelah baris kosong / tidak valid / dobel dibuang). */
  rowCount: number;
};

const normKey = (k: string) => String(k).trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const fmtRp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

const COLS = {
  code: ["custcode", "customercode", "kodecustomer", "soldto", "soldtoparty"],
  group: ["custgroup", "customergroup"],
  pn: ["partnumber", "nomorpart", "nopart"],
  price: ["harga", "price", "hargakontrak", "hargarupiah", "pricelist", "hargatertera"],
  type: ["pricetype", "tipeharga", "jenisharga"],
  product: ["product", "produk", "brand"],
  model: ["modelunit", "model", "modeldescription"],
  qty: ["qtyperunit", "qtyunit", "qty", "jumlahperunit"],
  freq: ["frekuensiganti", "frekuensigantihm", "frekuensi", "freqreplacement", "freqreplacementhm", "frequency", "frequencyhm"],
  hm: ["hmhari", "hmday", "hmperhari", "hmperday", "jamperhari"]
};
const LABEL: Record<keyof typeof COLS, string> = {
  code: "Cust. Code", group: "Cust. Group", pn: "Part Number", price: "Harga", type: "Price Type", product: "Product",
  model: "Model Unit", qty: "Qty per Unit", freq: "Frekuensi Ganti (HM)", hm: "HM per Hari"
};
const REQUIRED: Record<CheckKind, (keyof typeof COLS)[]> = {
  contract: ["code", "pn", "price"],
  non_contract: ["pn", "price"],
  parts: ["product", "model", "pn", "qty", "freq"]
};

function pick(n: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = n[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

/** Periksa isi file. `known` = data yang sudah ada di website (untuk cek Customer Code / Part Number yang belum dikenal). */
export async function checkUploadFile(file: File, kind: CheckKind, known: Pick<TemplateLists, "codes" | "partNumbers" | "products">): Promise<FileCheck> {
  const XLSX = await import("@e965/xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", raw: /\.csv$/i.test(file.name) });
  // Sama dengan yang dibaca saat disimpan: Data Harga = sheet pertama; Master Part = sheet dengan baris terbanyak.
  let sheet = wb.SheetNames[0];
  let rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheet], { defval: null });
  if (kind === "parts") {
    wb.SheetNames.forEach((name) => {
      const r = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: null });
      if (r.length > rows.length) {
        rows = r;
        sheet = name;
      }
    });
  }
  if (rows.length === 0) throw new Error("File kosong atau tidak terbaca.");

  const head = new Set<string>();
  rows.slice(0, 50).forEach((r) => Object.keys(r).forEach((k) => head.add(normKey(k))));
  const missingColumns = REQUIRED[kind].filter((c) => !COLS[c].some((k) => head.has(k))).map((c) => LABEL[c]);

  const issues = new Map<string, UioIssue>();
  const flag = (key: string, field: string, level: UioIssue["level"], message: string, row: number) => {
    let it = issues.get(key);
    if (!it) issues.set(key, (it = { field, level, message, count: 0, rows: [] }));
    it.count++;
    if (it.rows.length < 15) it.rows.push(row);
  };

  const codes = known.codes.length > 0 ? new Set(known.codes.map((c) => normCode(c))) : null;
  const pns = known.partNumbers.length > 0 ? new Set(known.partNumbers.map((p) => p.trim().toUpperCase())) : null;
  const mPn = known.partNumbers.length > 0 ? makeMatcher(known.partNumbers) : null;
  const mProduct = known.products.length > 0 ? makeMatcher(known.products) : null;
  const seen = new Map<string, { row: number; sig: string; price: number }>();
  const conflicts: { row: number; first: number; a: number; b: number; key: string }[] = [];
  let ok = 0;

  rows.forEach((r, i) => {
    const row = i + 2;
    if (Object.values(r).every((v) => v === null || txt(v) === "")) return;
    const n: Record<string, unknown> = {};
    Object.keys(r).forEach((k) => (n[normKey(k)] = r[k]));
    const pn = txt(pick(n, COLS.pn));
    const sig = JSON.stringify(Object.values(r).map((v) => txt(v)));

    if (kind === "parts") {
      const product = txt(pick(n, COLS.product));
      const model = txt(pick(n, COLS.model));
      const qty = Number(txt(pick(n, COLS.qty)).replace(",", "."));
      const freq = Number(txt(pick(n, COLS.freq)).replace(",", "."));
      if (!product || !model || !pn) return flag("req", "Product / Model / Part Number", "penting", "Product, Model Unit atau Part Number kosong — baris dilewati", row);
      if (!Number.isFinite(qty) || qty < 0) return flag("qty", "Qty per Unit", "penting", "Qty per Unit kosong / bukan angka — baris dilewati", row);
      if (!Number.isFinite(freq) || freq <= 0) return flag("freq", "Frekuensi Ganti", "penting", "Frekuensi Ganti (HM) kosong / 0 — baris dilewati", row);
      const hmRaw = txt(pick(n, COLS.hm));
      if (hmRaw && !(Number(hmRaw) > 0 && Number(hmRaw) <= 24)) flag("hm", "HM per Hari", "info", "HM per Hari di luar 1–24 — dipakai nilai default", row);
      if (mProduct) {
        const m = mProduct(canonicalProduct(product));
        if (m.exact === null && m.suggest) flag(`product-typo:${loose(product)}`, "Product", "penting", `Product "${product}" belum dikenal — mungkin maksudnya "${m.suggest}"? (abaikan bila memang brand baru)`, row);
      }
      const key = `${canonicalProduct(product)}|${model.toUpperCase()}|${pn.toUpperCase()}`;
      const prev = seen.get(key);
      if (prev) {
        if (prev.sig === sig) flag("dup", "Baris dobel", "info", `Baris sama persis dengan baris ${prev.row} — disimpan satu kali`, row);
        else flag("dup-diff", "Product + Model + Part Number", "penting", `Product + Model + Part Number sama dengan baris ${prev.row} tapi isinya berbeda (Qty / Frekuensi / HM) — yang dipakai baris paling bawah`, row);
        seen.set(key, { row, sig, price: 0 });
        return;
      }
      seen.set(key, { row, sig, price: 0 });
      ok++;
      return;
    }

    const price = parsePrice(pick(n, COLS.price));
    if (!pn) return flag("pn", "Part Number", "penting", "Part Number kosong — baris dilewati", row);
    if (price === null) return flag("price", "Harga", "penting", "Harga kosong / bukan angka — baris dilewati", row);
    if (price <= 0) flag("price0", "Harga", "penting", "Harga 0 atau negatif", row);
    if (pns && !pns.has(pn.toUpperCase())) {
      const m = mPn!(pn);
      const s = m.exact ?? m.suggest;
      if (s) flag(`pn-typo:${loose(pn)}`, "Part Number", "penting", `Part Number "${pn}" tidak ada di Master Part — mungkin maksudnya "${s}"?`, row);
      else flag("pn-unknown", "Part Number", "info", "Part Number tidak ada di Master Part — harga belum terpakai di Market Size", row);
    }

    let key = pn.toUpperCase();
    let who = `Part Number ${pn}`;
    if (kind === "contract") {
      const t = normPriceType(pick(n, COLS.type));
      if (t === "non_contract") return flag("nk", "Price Type", "info", "Price Type Non-Kontrak — baris dilewati (upload di slot Harga Non Kontrak)", row);
      const code = normCode(pick(n, COLS.code));
      if (!code) return flag("code", "Cust. Code", "penting", "Cust. Code kosong — baris dilewati (harga kontrak / SCPL wajib punya Customer Code)", row);
      if (codes && !codes.has(code)) flag("code-unknown", "Cust. Code", "info", "Customer Code belum ada di Data UIO — harga belum terpakai sampai unit customer ini ada", row);
      key = `${code}|${pn.toUpperCase()}|${t === "scpl" ? "scpl" : "contract"}`;
      who = `Customer ${code} · Part Number ${pn}`;
    }
    const prev = seen.get(key);
    if (prev) {
      if (prev.price === price) flag("dup", "Baris dobel", "info", `Harga sama dengan baris ${prev.row} (${who}) — disimpan satu kali`, row);
      else {
        conflicts.push({ row, first: prev.row, a: prev.price, b: price, key: who });
        flag(
          "conflict",
          "Harga berbeda",
          "penting",
          kind === "contract"
            ? "Customer Code + Part Number sama tapi harganya berbeda — yang disimpan baris paling bawah"
            : "Part Number sama tapi harganya berbeda — yang disimpan baris paling bawah",
          row
        );
      }
      seen.set(key, { row, sig, price });
      return;
    }
    seen.set(key, { row, sig, price });
    ok++;
  });

  // Contoh harga yang bentrok (supaya mudah dicek di Excel).
  const c = issues.get("conflict");
  if (c && conflicts.length > 0) {
    const ex = conflicts.slice(0, 3).map((x) => `${x.key}: baris ${x.first} ${fmtRp(x.a)} vs baris ${x.row} ${fmtRp(x.b)}`).join("; ");
    c.message += ` (contoh: ${ex}${conflicts.length > 3 ? "; …" : ""})`;
  }
  const order = { penting: 0, info: 1 };
  return {
    sheet,
    rowCount: ok,
    totalRows: rows.length,
    missingColumns,
    issues: Array.from(issues.values()).sort((a, b) => order[a.level] - order[b.level] || b.count - a.count)
  };
}
