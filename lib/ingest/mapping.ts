import type { DataType, RawRow, RowError } from "./contracts";
import { getAdapter, getAvailabilityAdapter, getPricingAdapter, getVisibilityAdapter, getProductAdapter } from "./adapters";
import type { PlatformSlug } from "@/lib/types";

export type ColumnMapping = Record<string, string>;
export interface CanonicalField { key: string; label: string; required: boolean; aliases: string[]; adapterHeader: string; }

const common = {
  skuCode: { key: "skuCode", label: "SKU", required: true, aliases: ["sku", "sku code", "sku_code", "skuid", "item code", "product id"], adapterHeader: "SKU Code" },
  date: { key: "date", label: "Date", required: true, aliases: ["date", "day", "observation date", "snapshot date"], adapterHeader: "Date" },
  cityName: { key: "cityName", label: "City", required: true, aliases: ["city", "location", "city name"], adapterHeader: "City" },
};
const fields: Record<DataType, CanonicalField[]> = {
  sales: [common.skuCode, common.date,
    { key: "gmv", label: "Revenue / GMV", required: true, aliases: ["gmv", "revenue", "sales", "net sales", "netsales"], adapterHeader: "GMV" },
    { key: "units", label: "Units sold", required: true, aliases: ["units", "units sold", "quantity", "qty", "qtysold"], adapterHeader: "Units Sold" },
    { key: "avgSellPrice", label: "Average selling price", required: false, aliases: ["asp", "avg selling price", "selling price"], adapterHeader: "ASP" },
    { key: "discountPct", label: "Discount %", required: false, aliases: ["discount", "discount %", "discount pct"], adapterHeader: "Discount %" }],
  availability: [common.skuCode, common.cityName, common.date,
    { key: "storesTotal", label: "Stores total", required: false, aliases: ["stores total", "total stores", "stores"], adapterHeader: "Stores Total" },
    { key: "storesInStock", label: "Stores in stock", required: false, aliases: ["stores in stock", "available stores", "in stock stores"], adapterHeader: "Stores In Stock" },
    { key: "availability", label: "Availability status", required: false, aliases: ["availability", "status", "stock status", "in stock", "available"], adapterHeader: "Availability" }],
  pricing: [common.skuCode, { ...common.cityName, required: false }, common.date,
    { key: "sellingPrice", label: "Selling price", required: true, aliases: ["selling price", "price", "sp"], adapterHeader: "Selling Price" },
    { key: "mrp", label: "MRP", required: false, aliases: ["mrp", "list price"], adapterHeader: "MRP" },
    { key: "discountPct", label: "Discount %", required: false, aliases: ["discount", "discount %", "discount pct"], adapterHeader: "Discount %" }],
  visibility: [
    { key: "keyword", label: "Keyword", required: true, aliases: ["keyword", "search term", "query"], adapterHeader: "Keyword" },
    { ...common.cityName, required: false }, common.date,
    { key: "observedBrand", label: "Observed brand", required: true, aliases: ["brand", "observed brand", "seller", "advertiser"], adapterHeader: "Brand" },
    { ...common.skuCode, required: false },
    { key: "rank", label: "Rank", required: true, aliases: ["rank", "position", "search rank"], adapterHeader: "Rank" },
    { key: "page", label: "Page", required: false, aliases: ["page", "result page"], adapterHeader: "Page" },
    { key: "isSponsored", label: "Sponsored", required: false, aliases: ["sponsored", "is sponsored", "ad", "type"], adapterHeader: "Sponsored" }],
  products: [
    { ...common.skuCode, required: false },
    { key: "name", label: "Product name", required: true, aliases: ["product name", "item name", "name", "product", "title"], adapterHeader: "Product Name" },
    { key: "platformProductId", label: "Platform item ID", required: false, aliases: ["item id", "product id", "platform product id", "listing id"], adapterHeader: "Item ID" },
    { key: "packSize", label: "Pack size", required: false, aliases: ["pack size", "unit", "uom", "weight", "variant"], adapterHeader: "Pack Size" },
    { key: "mrp", label: "MRP", required: false, aliases: ["mrp", "list price", "max retail price"], adapterHeader: "MRP" },
    { key: "category", label: "Category", required: false, aliases: ["category", "l1 category", "sub category"], adapterHeader: "Category" }],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
export const canonicalFields = (type: DataType) => fields[type];

export function suggestMapping(headers: string[], type: DataType) {
  return headers.map((source) => {
    const n = norm(source);
    const matches = fields[type].filter((f) => f.aliases.some((a) => norm(a) === n));
    return { source, target: matches.length === 1 ? matches[0].key : null, confidence: matches.length === 1 ? 1 : 0, ambiguous: matches.length > 1 };
  });
}

export function validateMapping(mapping: ColumnMapping, type: DataType): string[] {
  const values = Object.values(mapping).filter(Boolean);
  const duplicate = values.find((v, i) => values.indexOf(v) !== i);
  const errors = duplicate ? [`Canonical field '${duplicate}' is mapped more than once`] : [];
  for (const f of fields[type].filter((x) => x.required)) if (!values.includes(f.key)) errors.push(`Required field '${f.label}' is not mapped`);
  if (type === "products" && !values.includes("skuCode") && !values.includes("platformProductId")) errors.push("Map the SKU code or the platform item ID");
  if (type === "availability" && !values.includes("availability") && !(values.includes("storesTotal") && values.includes("storesInStock"))) errors.push("Map availability status or both store count fields");
  return errors;
}

export function applyMapping(rows: RawRow[], mapping: ColumnMapping, type: DataType): RawRow[] {
  const byKey = new Map(fields[type].map((f) => [f.key, f.adapterHeader]));
  return rows.map((row) => Object.fromEntries(Object.entries(mapping).filter(([, target]) => target).map(([source, target]) => [byKey.get(target)!, row[source] ?? ""])));
}

export function parseMapped(rows: RawRow[], mapping: ColumnMapping, type: DataType, platform: PlatformSlug) {
  const mapped = applyMapping(rows, mapping, type);
  if (type === "availability") return getAvailabilityAdapter(platform).parse(mapped);
  if (type === "pricing") return getPricingAdapter(platform).parse(mapped);
  if (type === "visibility") return getVisibilityAdapter(platform).parse(mapped);
  if (type === "products") return getProductAdapter(platform).parse(mapped);
  return getAdapter(platform).parse(mapped);
}

export function validationSummary(rows: RawRow[], mapping: ColumnMapping, type: DataType, platform: PlatformSlug) {
  const result = parseMapped(rows, mapping, type, platform);
  const seen = new Set<string>(); let duplicates = 0;
  for (const row of rows) { const key = JSON.stringify(Object.values(mapping).map((_, i) => Object.values(row)[i])); if (seen.has(key)) duplicates++; else seen.add(key); }
  return { total: rows.length, valid: result.rows.length, invalid: result.errors.length, warnings: duplicates, duplicates, errors: result.errors.slice(0, 500) as RowError[] };
}
