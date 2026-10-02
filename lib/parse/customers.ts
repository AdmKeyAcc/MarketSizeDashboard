import * as XLSX from "@e965/xlsx";
import { cellAt, findSheet, sheetLastRow, str, num, ParseError } from "./xlsxHelpers";
import type { Customer } from "@/lib/types";

export function parseCustomerWorkbook(wb: XLSX.WorkBook): Customer[] {
  const ws = findSheet(wb, "Cust Data");

  const brands: string[] = [];
  for (let col = 8; col <= 40; col++) {
    const b = cellAt(ws, 3, col);
    if (b === null) {
      if (brands.length) break;
      else continue;
    }
    brands.push(String(b).trim());
  }
  if (brands.length === 0) {
    throw new ParseError("Kolom brand (baris 3, mulai kolom H) tidak ditemukan.");
  }
  const totalCol = 7 + brands.length + 1;

  const customers: Customer[] = [];
  const lastRow = Math.max(sheetLastRow(ws), 200);
  for (let row = 4; row <= lastRow && row <= 5000; row++) {
    const group = cellAt(ws, row, 3);
    const name = cellAt(ws, row, 6); 
    if (group === null && name === null) continue;
    const uioByBrand: Record<string, number> = {};
    brands.forEach((b, i) => {
      uioByBrand[b] = num(cellAt(ws, row, 8 + i));
    });
    customers.push({
      no: (cellAt(ws, row, 2) as number | null) ?? null,
      customer_group: str(group),
      cabang: str(cellAt(ws, row, 4)),
      customer_code: str(cellAt(ws, row, 5)),
      customer_name: str(name),
      pss: str(cellAt(ws, row, 7)),
      // Kolom opsional setelah Total UIO — file lama tanpa kolom ini
      // otomatis dapat tier: null, tidak error.
      tier: str(cellAt(ws, row, totalCol + 1)),
      uio_by_brand: uioByBrand,
      total_uio: num(cellAt(ws, row, totalCol))
    });
  }

  const named = customers.filter((c) => c.customer_name);
  if (named.length === 0) {
    throw new ParseError("Tidak ada baris customer (kolom Customer Name) yang terbaca.");
  }
  return customers;
}
