import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Endpoint lama (Data Harga tunggal). Sudah diganti dua endpoint terpisah:
 *  /api/upload/price-contract (SCPL, harga nett) dan
 *  /api/upload/price-non-contract (harga tertera - 50%). */
export async function POST() {
  return NextResponse.json(
    { error: "Endpoint ini sudah tidak dipakai. Gunakan upload Data Harga Kontrak atau Non Kontrak." },
    { status: 410 }
  );
}
