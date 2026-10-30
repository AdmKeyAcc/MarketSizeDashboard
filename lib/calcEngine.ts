/**
 * Mesin hitung page Calculator. Memakai fungsi yang SAMA dengan Dashboard & Summary
 * (buildCustomerIndex + computeCustomerFacts), sehingga angka kalkulator untuk part / customer / tahun
 * yang sama persis sama dengan angka di hierarki Dashboard dan tabel Summary:
 *   - dihitung per customer (pembulatan qty per customer × part, seperti Dashboard),
 *   - harga per customer: kontrak (Customer Group-nya) → Non Kontrak → Pricelist,
 *   - jam operasi per bulan mengikuti kalender hari kerja & Month Inv.
 * Nilai yang diisi manual (HM/Day, Day/Month, Month/Year, UIO, Harga) menimpa data otomatis.
 */
import {
  EMPTY_FILTERS,
  addUnitHm,
  canonicalProduct,
  defaultWorkdaysOf,
  emptyUnitHm,
  normModel,
  partAnnualHm,
  type UnitHm
} from "@/lib/calculations";
import { buildCustomerIndex, computeCustomerFacts, makeFactDeps, type CustInfo } from "@/lib/hierarchy";
import { calendarWeights, sumPeriod } from "@/lib/period";
import { refs } from "@/lib/references";
import { resolvePriceInfo, type PriceSource } from "@/lib/calcHelpers";
import type { Part, PriceListEntry, UioUnit } from "@/lib/types";

const up = (s: string | null | undefined) => (s || "").trim().toUpperCase();

export type CalcScope = {
  year: number | null;
  group: string;
  customer: string;
};

export type CalcOverrides = {
  hmDay?: number | null;
  dayMonth?: number | null;
  monthYear?: number | null;
  uio?: number | null;
  price?: number | null;
};

export type CalcResult = {
  /** Unit di Data UIO yang cocok dengan Product + Model part (sampai tahun acuan). */
  uioAuto: number;
  uio: number;
  customers: number;
  /** Rata-rata per unit (otomatis dari Data UIO; default kalau kosong). */
  avg: { hmDay: number; dayMonth: number; monthYear: number; annualHm: number };
  /** Annual HM per unit yang dipakai (setelah nilai manual). */
  annualHm: number;
  qty: number;
  amount: number;
  /** Harga rata-rata tertimbang (Rp / pcs) — bisa beda per customer group. */
  price: number;
  /** Harga otomatis (sebelum diisi manual). */
  priceAuto: number;
  priceSources: Record<PriceSource, number>;
  priceLabel: string;
  qtyM: Float64Array;
  amountM: Float64Array;
  /** true = memakai rumus sederhana (UIO diisi manual tanpa unit di Data UIO). */
  simple: boolean;
};

/** Customer (dari Data UIO) dalam cakupan Customer Group / Customer — dibuat sekali per pilihan. */
export function scopeCustomers(units: UioUnit[], priceList: PriceListEntry[], scope: Pick<CalcScope, "group" | "customer">): CustInfo[] {
  const g = up(scope.group);
  const n = up(scope.customer);
  const inScope = units.filter((u) => (!g || up(u.customer_group) === g) && (!n || up(u.customer_name) === n));
  return buildCustomerIndex([], inScope, [], priceList).filter((c) => c.units.length > 0);
}

/** Unit customer yang dihitung untuk part ini: model sama persis, kalau tidak ada → model part sebagai awalan (aturan Dashboard). */
function matchedUnits(c: CustInfo, product: string, partModel: string, year: number | null): UioUnit[] {
  const pk = canonicalProduct(product);
  const pm = normModel(partModel);
  const exact: UioUnit[] = [];
  const prefix: UioUnit[] = [];
  c.units.forEach((u) => {
    if (canonicalProduct(u.product) !== pk) return;
    if (year !== null && u.year !== null && u.year > year) return;
    const nm = normModel(u.model);
    if (nm === pm) exact.push(u);
    else if (pm.length >= 3 && nm.startsWith(pm)) prefix.push(u);
  });
  return exact.length > 0 ? exact : prefix;
}

const positive = (v: number | null | undefined, max: number) => (typeof v === "number" && v > 0 && v <= max ? v : null);

export function calcPart(
  part: Part,
  custs: CustInfo[],
  priceList: PriceListEntry[],
  scope: CalcScope,
  ov: CalcOverrides = {}
): CalcResult {
  const s = refs().settings;
  const year = scope.year ?? new Date().getFullYear();
  const hmOv = positive(ov.hmDay, 24);
  const dmOv = positive(ov.dayMonth, 31);
  const myOv = positive(ov.monthYear, 12);
  const applyOv = (u: UioUnit): UioUnit =>
    hmOv || dmOv || myOv
      ? { ...u, hm_day: hmOv ?? u.hm_day, day_month: dmOv ?? u.day_month, month_year: myOv ?? u.month_year }
      : u;

  // Rata-rata nilai di Data UIO (sebelum diisi manual) + unit per customer.
  let uioAuto = 0;
  let sumHm = 0, sumDm = 0, sumMy = 0;
  const aggAll: UnitHm = emptyUnitHm();
  const partHm = positive(part.hm_day, 24) ?? s.default_hm_day;
  const scoped = custs.map((c) => {
    const mu = matchedUnits(c, part.product, part.model, scope.year);
    mu.forEach((u) => {
      uioAuto++;
      sumHm += positive(u.hm_day, 24) ?? partHm;
      sumDm += positive(u.day_month, 31) ?? s.default_workdays_month;
      sumMy += positive(u.month_year, 12) ?? s.default_months_year;
      addUnitHm(aggAll, applyOv(u), defaultWorkdaysOf, year);
    });
    return { c, n: mu.length };
  });
  const avg = {
    hmDay: uioAuto ? sumHm / uioAuto : partHm,
    dayMonth: uioAuto ? sumDm / uioAuto : s.default_workdays_month,
    monthYear: uioAuto ? sumMy / uioAuto : s.default_months_year,
    annualHm: 0
  };
  avg.annualHm = uioAuto ? partAnnualHm(aggAll, part.hm_day, part.product, defaultWorkdaysOf).annualHm : 0;

  const priceSources: Record<PriceSource, number> = { contract: 0, non_contract: 0, pricelist: 0 };
  const qtyM = new Float64Array(12);
  const amountM = new Float64Array(12);
  let qty = 0, amount = 0, customers = 0;

  const uioOv = typeof ov.uio === "number" && ov.uio >= 0 ? ov.uio : null;

  if (uioAuto > 0) {
    // Mesin Dashboard, per customer.
    const deps = makeFactDeps([part], priceList, year, EMPTY_FILTERS);
    scoped.forEach(({ c, n }) => {
      if (n === 0) return;
      const cc = hmOv || dmOv || myOv ? { ...c, units: c.units.map(applyOv) } : c;
      const facts = computeCustomerFacts(cc, deps);
      if (facts.length === 0) return;
      customers++;
      priceSources[resolvePriceInfo(priceList, part.part_number, c.priceGroup || c.group, part.pricelist).source]++;
      facts.forEach((f) => {
        qty += f.qty;
        amount += f.ms;
        for (let m = 0; m < 12; m++) {
          qtyM[m] += f.qtyM[m];
          amountM[m] += f.msM[m];
        }
      });
    });
    // UIO diisi manual → diskalakan dari populasi yang sama.
    if (uioOv !== null && uioOv !== uioAuto) {
      const r = uioOv / uioAuto;
      const q2 = Math.round(qty * r);
      const k = qty > 0 ? q2 / qty : r;
      amount *= k;
      for (let m = 0; m < 12; m++) {
        qtyM[m] *= k;
        amountM[m] *= k;
      }
      qty = q2;
    }
  }

  const annualHmUsed = uioAuto
    ? avg.annualHm
    : (hmOv ?? partHm) * (dmOv ?? s.default_workdays_month) * (myOv ?? s.default_months_year);

  let simple = false;
  if (uioAuto === 0 && uioOv) {
    // Tidak ada unit di Data UIO tapi UIO diisi manual: rumus sederhana, disebar per hari kerja kalender.
    simple = true;
    customers = 0;
    const info = resolvePriceInfo(priceList, part.part_number, scope.group, part.pricelist);
    priceSources[info.source]++;
    const raw = part.freq_replacement_hm > 0 ? (annualHmUsed / part.freq_replacement_hm) * part.qty_per_unit * uioOv : 0;
    qty = Math.round(raw);
    amount = qty * info.price;
    const w = calendarWeights();
    for (let m = 0; m < 12; m++) {
      qtyM[m] = (qty * w[m]) / 12;
      amountM[m] = qtyM[m] * info.price;
    }
  }

  let price = qty > 0 ? amount / qty : resolvePriceInfo(priceList, part.part_number, scope.group, part.pricelist).price;
  const priceAuto = price;
  const priceOv = typeof ov.price === "number" && ov.price >= 0 ? ov.price : null;
  if (priceOv !== null) {
    price = priceOv;
    amount = qty * priceOv;
    for (let m = 0; m < 12; m++) amountM[m] = qtyM[m] * priceOv;
  }

  const kinds = (Object.keys(priceSources) as PriceSource[]).filter((k) => priceSources[k] > 0);
  const LABEL: Record<PriceSource, string> = { contract: "Harga kontrak", non_contract: "Harga Non Kontrak", pricelist: "Pricelist Master Part" };
  const priceLabel =
    priceOv !== null
      ? "Diisi manual"
      : kinds.length === 0
        ? resolvePriceInfo(priceList, part.part_number, scope.group, part.pricelist).label
        : kinds.length === 1
          ? kinds[0] === "contract" && scope.group
            ? `Harga kontrak ${scope.group}`
            : LABEL[kinds[0]]
          : `Campuran: ${kinds.map((k) => `${priceSources[k]} customer ${LABEL[k].toLowerCase()}`).join(", ")}`;

  return {
    uioAuto,
    uio: uioOv ?? uioAuto,
    customers,
    avg,
    annualHm: annualHmUsed,
    qty,
    amount,
    price,
    priceAuto,
    priceSources,
    priceLabel,
    qtyM,
    amountM,
    simple
  };
}

/** Jumlah bulan terpilih (null = setahun). */
export const periodSum = (arr: Float64Array, months: number[] | null, annual: number) => sumPeriod(arr, months, annual);
