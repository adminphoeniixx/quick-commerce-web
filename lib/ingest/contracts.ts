// Ingestion contracts. Each platform adapter turns raw export rows into a
// normalized sales row; the ingest service writes those into fact tables.
import type { PlatformSlug } from "@/lib/types";

export type RawRow = Record<string, string>;

export interface NormalizedSalesRow {
  skuCode: string;
  date: string; // YYYY-MM-DD
  gmv: number;
  unitsSold: number;
  avgSellPrice?: number;
  discountPct?: number;
  // Optional catalog attributes (order-level exports carry them); used to create unknown SKUs.
  productName?: string;
  mrp?: number;
  category?: string;
}

export interface RowError {
  row: number; // 1-based row number in the source file
  message: string;
}

export interface NormalizedAvailabilityRow {
  skuCode: string;
  cityName: string;
  date: string; // YYYY-MM-DD
  storesTotal: number;
  storesInStock: number;
}

export interface NormalizedPricingRow {
  skuCode: string;
  cityName: string; // "National" when the export has no city dimension
  date: string;
  sellingPrice: number;
  mrp?: number;
  discountPct?: number;
}

export interface NormalizedVisibilityRow {
  keyword: string;
  cityName: string; // "National" when the export has no city dimension
  date: string;
  observedBrand: string;
  skuCode?: string;
  rank: number;
  page?: number;
  isSponsored: boolean;
}

export type DataType = "sales" | "availability" | "pricing" | "visibility" | "products";

export interface AdapterResult<T = NormalizedSalesRow> {
  rows: T[];
  errors: RowError[];
}

export interface SalesAdapter {
  platform: PlatformSlug;
  /** Columns that must be present in the export (any one of each group). */
  requiredColumns: string[];
  parse(raw: RawRow[]): AdapterResult<NormalizedSalesRow>;
}

export interface AvailabilityAdapter {
  platform: PlatformSlug;
  requiredColumns: string[];
  parse(raw: RawRow[]): AdapterResult<NormalizedAvailabilityRow>;
}

export interface PricingAdapter {
  platform: PlatformSlug;
  requiredColumns: string[];
  parse(raw: RawRow[]): AdapterResult<NormalizedPricingRow>;
}

export interface NormalizedProductRow {
  skuCode: string;
  name: string;
  packSize?: string;
  mrp?: number;
  category?: string;
  platformProductId?: string;
}

export interface ProductAdapter {
  platform: PlatformSlug;
  requiredColumns: string[];
  parse(raw: RawRow[]): AdapterResult<NormalizedProductRow>;
}

export interface VisibilityAdapter {
  platform: PlatformSlug;
  requiredColumns: string[];
  parse(raw: RawRow[]): AdapterResult<NormalizedVisibilityRow>;
}

// Parse a yes/no/true/1/available style flag; returns null if unrecognizable.
export function toBool(v: string | undefined): boolean | null {
  if (v == null || v === "") return null;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "y", "available", "in stock", "instock", "in_stock"].includes(s)) return true;
  if (["0", "false", "no", "n", "unavailable", "out of stock", "oos", "out_of_stock"].includes(s)) return false;
  return null;
}

// ---- shared parsing helpers ----
export function toNumber(v: string | undefined): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY. Returns YYYY-MM-DD or null.
export function toDate(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const d = m[1].padStart(2, "0"), mo = m[2].padStart(2, "0");
    return `${m[3]}-${mo}-${d}`;
  }
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

/** Pick the first present column from candidates (case-insensitive). */
export function pick(row: RawRow, candidates: string[]): string | undefined {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const k = keys.find((k) => k.toLowerCase().trim() === c.toLowerCase());
    if (k && row[k] !== "") return row[k];
  }
  return undefined;
}
