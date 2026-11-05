import type { DashboardData } from "@/lib/types";
import type { TemplateLists } from "@/lib/downloadTemplates";
import { canonicalProduct } from "@/lib/calculations";
import { refs } from "@/lib/references";

const t = (v: string | null | undefined) => (v || "").trim();

/** Daftar pilihan dropdown template, diambil dari data yang sudah ada di website
 * (Master Part, Data UIO, Master Customer, Actual Sales, Data Harga). */
export function buildTemplateLists(d: DashboardData): TemplateLists {
  const branches = new Set<string>();
  const pss = new Set<string>();
  const groups = new Set<string>();
  const names = new Set<string>();
  const products = new Set<string>();
  const models = new Map<string, Set<string>>();
  const pns = new Set<string>();
  const partModels = new Map<string, Set<string>>();
  const addModel = (p: string | null | undefined, m: string | null | undefined) => {
    const pk = p ? canonicalProduct(p) : "";
    const mm = t(m);
    if (!pk) return;
    products.add(pk);
    if (!mm) return;
    let s = models.get(pk);
    if (!s) models.set(pk, (s = new Set()));
    s.add(mm);
  };
  d.parts.forEach((p) => {
    addModel(p.product, p.model);
    const pk = canonicalProduct(p.product);
    let s = partModels.get(pk);
    if (!s) partModels.set(pk, (s = new Set()));
    if (t(p.model)) s.add(t(p.model));
    if (t(p.part_number)) pns.add(t(p.part_number));
  });
  d.uioUnits.forEach((u) => {
    addModel(u.product, u.model);
    if (t(u.branch)) branches.add(t(u.branch).toUpperCase());
    if (t(u.pss_name)) pss.add(t(u.pss_name));
    if (t(u.customer_group)) groups.add(t(u.customer_group));
    if (t(u.customer_name)) names.add(t(u.customer_name));
  });
  d.customers.forEach((c) => {
    if (t(c.cabang)) branches.add(t(c.cabang).toUpperCase());
    if (t(c.pss)) pss.add(t(c.pss));
    if (t(c.customer_group)) groups.add(t(c.customer_group));
    if (t(c.customer_name)) names.add(t(c.customer_name));
  });
  d.actualSalesYear.forEach((r) => {
    if (t(r.customer_group)) groups.add(t(r.customer_group));
    if (t(r.customer_name)) names.add(t(r.customer_name));
  });
  d.priceList.forEach((p) => {
    if (t(p.customer_group)) groups.add(t(p.customer_group));
  });
  const arr = (s: Set<string>) => Array.from(s).sort((a, b) => a.localeCompare(b));
  const modelsByProduct: Record<string, string[]> = {};
  models.forEach((s, p) => (modelsByProduct[p] = arr(s)));
  const partModelsByProduct: Record<string, string[]> = {};
  partModels.forEach((s, p) => (partModelsByProduct[p] = arr(s)));
  return {
    branches: arr(branches),
    pss: arr(pss),
    groups: arr(groups),
    names: arr(names),
    custTypes: refs().kaTypes.slice(),
    products: arr(products),
    modelsByProduct,
    partNumbers: arr(pns),
    partModelsByProduct
  };
}
