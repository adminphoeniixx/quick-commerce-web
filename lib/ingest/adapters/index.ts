// Platform sales adapters. Each maps a platform's seller-panel export columns
// to the normalized sales row. Column names are configurable candidates — these
// are sensible defaults for CSV/Excel exports, NOT undocumented platform APIs.
import type { PlatformSlug } from "@/lib/types";
import {
  type SalesAdapter, type AvailabilityAdapter, type PricingAdapter, type VisibilityAdapter, type ProductAdapter,
  type RawRow, type AdapterResult,
  type NormalizedAvailabilityRow, type NormalizedPricingRow, type NormalizedVisibilityRow, type NormalizedProductRow,
  toNumber, toDate, toBool, pick,
} from "../contracts";

interface ColumnMap {
  skuCode: string[];
  date: string[];
  gmv: string[];
  units: string[];
  asp?: string[];
  discount?: string[];
  // Order-level exports: rows whose status matches CANCELLED_STATUS are skipped (not errors).
  status?: string[];
  productName?: string[];
  mrp?: string[];
  category?: string[];
}

const CANCELLED_STATUS = /cancel|return|rto|refund|fail|undeliver/i;

function buildAdapter(platform: PlatformSlug, cols: ColumnMap): SalesAdapter {
  return {
    platform,
    requiredColumns: [cols.skuCode[0], cols.date[0], cols.gmv[0], cols.units[0]],
    parse(raw: RawRow[]): AdapterResult {
      const rows: AdapterResult["rows"] = [];
      const errors: AdapterResult["errors"] = [];
      raw.forEach((r, i) => {
        const rowNum = i + 2; // +1 for 0-index, +1 for header row
        if (cols.status && CANCELLED_STATUS.test(pick(r, cols.status) ?? "")) return;
        const skuCode = pick(r, cols.skuCode);
        const date = toDate(pick(r, cols.date));
        const gmv = toNumber(pick(r, cols.gmv));
        const units = toNumber(pick(r, cols.units));

        if (!skuCode) return errors.push({ row: rowNum, message: "Missing SKU code" });
        if (!date) return errors.push({ row: rowNum, message: "Missing or invalid date" });
        if (gmv == null) return errors.push({ row: rowNum, message: "Missing or invalid GMV" });
        if (units == null) return errors.push({ row: rowNum, message: "Missing or invalid units" });
        if (gmv < 0 || units < 0) return errors.push({ row: rowNum, message: "Negative values not allowed" });

        rows.push({
          skuCode: skuCode.trim(),
          date,
          gmv,
          unitsSold: Math.round(units),
          avgSellPrice: cols.asp ? toNumber(pick(r, cols.asp)) ?? undefined : undefined,
          discountPct: cols.discount ? toNumber(pick(r, cols.discount)) ?? undefined : undefined,
          productName: cols.productName ? pick(r, cols.productName)?.trim() || undefined : undefined,
          mrp: cols.mrp ? toNumber(pick(r, cols.mrp)) ?? undefined : undefined,
          category: cols.category ? pick(r, cols.category)?.trim() || undefined : undefined,
        });
      });
      return { rows, errors };
    },
  };
}

export const ADAPTERS: Record<PlatformSlug, SalesAdapter> = {
  // Also covers the seller panel's order-level "Sales Summary" export
  // (Order Id, Order Date, Item Id, Product Name, Quantity, Total Gross Bill Amount, …).
  blinkit: buildAdapter("blinkit", {
    skuCode: ["SKU Code", "sku_code", "sku", "Item Id"],
    date: ["Date", "date", "Order Date"],
    gmv: ["GMV", "gmv", "Sales", "sales", "Total Gross Bill Amount"],
    units: ["Units Sold", "units", "qty", "Quantity"],
    asp: ["ASP", "Avg Selling Price", "avg_sell_price"],
    discount: ["Discount %", "discount", "discount_pct"],
    status: ["Order Status"],
    productName: ["Product Name"],
    mrp: ["MRP (Rs)", "MRP"],
    category: ["Business Category"],
  }),
  zepto: buildAdapter("zepto", {
    skuCode: ["sku", "SKU", "sku_code"],
    date: ["date", "Date"],
    gmv: ["sales", "Sales", "gmv", "revenue"],
    units: ["qty", "quantity", "units"],
    asp: ["selling_price", "sp", "asp"],
    discount: ["discount", "discount_pct"],
  }),
  instamart: buildAdapter("instamart", {
    skuCode: ["Item Code", "item_code", "sku"],
    date: ["Day", "Date", "date"],
    gmv: ["Revenue", "revenue", "gmv", "sales"],
    units: ["Units", "units", "qty"],
    asp: ["Avg Price", "avg_price", "asp"],
    discount: ["Discount", "discount"],
  }),
  bigbasket: buildAdapter("bigbasket", {
    skuCode: ["SKUID", "sku_id", "sku"],
    date: ["Date", "date"],
    gmv: ["NetSales", "net_sales", "gmv", "sales"],
    units: ["QtySold", "qty_sold", "units"],
    asp: ["SP", "sp", "asp"],
    discount: ["Discount", "discount"],
  }),
};

export function getAdapter(slug: PlatformSlug): SalesAdapter {
  const a = ADAPTERS[slug];
  if (!a) throw new Error(`No adapter for platform: ${slug}`);
  return a;
}

// ---------------- availability ----------------
interface AvailCols {
  skuCode: string[]; city: string[]; date: string[];
  storesTotal?: string[]; storesInStock?: string[]; status?: string[];
}

function buildAvailabilityAdapter(platform: PlatformSlug, cols: AvailCols): AvailabilityAdapter {
  return {
    platform,
    requiredColumns: [cols.skuCode[0], cols.city[0], cols.date[0]],
    parse(raw: RawRow[]): AdapterResult<NormalizedAvailabilityRow> {
      const rows: NormalizedAvailabilityRow[] = [];
      const errors: AdapterResult["errors"] = [];
      raw.forEach((r, i) => {
        const rowNum = i + 2;
        const skuCode = pick(r, cols.skuCode);
        const cityName = pick(r, cols.city);
        const date = toDate(pick(r, cols.date));
        if (!skuCode) return errors.push({ row: rowNum, message: "Missing SKU code" });
        if (!cityName) return errors.push({ row: rowNum, message: "Missing city" });
        if (!date) return errors.push({ row: rowNum, message: "Missing or invalid date" });

        const total = cols.storesTotal ? toNumber(pick(r, cols.storesTotal)) : null;
        const inStock = cols.storesInStock ? toNumber(pick(r, cols.storesInStock)) : null;

        if (total != null && inStock != null) {
          if (total <= 0) return errors.push({ row: rowNum, message: "stores_total must be > 0" });
          if (inStock < 0 || inStock > total) return errors.push({ row: rowNum, message: "stores_in_stock out of range" });
          rows.push({ skuCode: skuCode.trim(), cityName: cityName.trim(), date, storesTotal: total, storesInStock: inStock });
          return;
        }
        // binary availability — do NOT fabricate quantities; model as 1 store.
        const avail = cols.status ? toBool(pick(r, cols.status)) : null;
        if (avail == null) return errors.push({ row: rowNum, message: "Missing availability (status or store counts)" });
        rows.push({ skuCode: skuCode.trim(), cityName: cityName.trim(), date, storesTotal: 1, storesInStock: avail ? 1 : 0 });
      });
      return { rows, errors };
    },
  };
}

const AVAIL_COMMON = {
  skuCode: ["SKU Code", "sku_code", "sku", "SKUID", "Item Code"],
  city: ["City", "city", "Location", "location"],
  date: ["Date", "date", "Day"],
  storesTotal: ["Stores Total", "stores_total", "total_stores", "Stores"],
  storesInStock: ["Stores In Stock", "stores_in_stock", "in_stock_stores", "Available Stores"],
  status: ["Availability", "availability", "Status", "in_stock", "available", "Stock Status"],
};

export const AVAILABILITY_ADAPTERS: Record<PlatformSlug, AvailabilityAdapter> = {
  blinkit: buildAvailabilityAdapter("blinkit", AVAIL_COMMON),
  zepto: buildAvailabilityAdapter("zepto", AVAIL_COMMON),
  instamart: buildAvailabilityAdapter("instamart", AVAIL_COMMON),
  bigbasket: buildAvailabilityAdapter("bigbasket", AVAIL_COMMON),
};

export function getAvailabilityAdapter(slug: PlatformSlug): AvailabilityAdapter {
  const a = AVAILABILITY_ADAPTERS[slug];
  if (!a) throw new Error(`No availability adapter for platform: ${slug}`);
  return a;
}

// ---------------- pricing ----------------
interface PriceCols {
  skuCode: string[]; city?: string[]; date: string[];
  sellingPrice: string[]; mrp?: string[]; discount?: string[];
}

function buildPricingAdapter(platform: PlatformSlug, cols: PriceCols): PricingAdapter {
  return {
    platform,
    requiredColumns: [cols.skuCode[0], cols.date[0], cols.sellingPrice[0]],
    parse(raw: RawRow[]): AdapterResult<NormalizedPricingRow> {
      const rows: NormalizedPricingRow[] = [];
      const errors: AdapterResult["errors"] = [];
      raw.forEach((r, i) => {
        const rowNum = i + 2;
        const skuCode = pick(r, cols.skuCode);
        const date = toDate(pick(r, cols.date));
        const sp = toNumber(pick(r, cols.sellingPrice));
        if (!skuCode) return errors.push({ row: rowNum, message: "Missing SKU code" });
        if (!date) return errors.push({ row: rowNum, message: "Missing or invalid date" });
        if (sp == null) return errors.push({ row: rowNum, message: "Missing or invalid selling price" });
        if (sp < 0) return errors.push({ row: rowNum, message: "Negative selling price" });

        const mrp = cols.mrp ? toNumber(pick(r, cols.mrp)) ?? undefined : undefined;
        if (mrp != null && mrp < sp) return errors.push({ row: rowNum, message: "MRP is lower than selling price" });
        let discountPct = cols.discount ? toNumber(pick(r, cols.discount)) ?? undefined : undefined;
        if (discountPct == null && mrp && mrp > 0) discountPct = Math.round(((mrp - sp) / mrp) * 1000) / 10;

        const cityName = (cols.city ? pick(r, cols.city) : undefined)?.trim() || "National";
        rows.push({ skuCode: skuCode.trim(), cityName, date, sellingPrice: sp, mrp, discountPct });
      });
      return { rows, errors };
    },
  };
}

const PRICE_COMMON = {
  skuCode: ["SKU Code", "sku_code", "sku", "SKUID", "Item Code"],
  city: ["City", "city", "Location"],
  date: ["Date", "date", "Day"],
  sellingPrice: ["Selling Price", "selling_price", "SP", "sp", "Price", "price"],
  mrp: ["MRP", "mrp", "List Price"],
  discount: ["Discount %", "discount", "discount_pct", "Discount"],
};

export const PRICING_ADAPTERS: Record<PlatformSlug, PricingAdapter> = {
  blinkit: buildPricingAdapter("blinkit", PRICE_COMMON),
  zepto: buildPricingAdapter("zepto", PRICE_COMMON),
  instamart: buildPricingAdapter("instamart", PRICE_COMMON),
  bigbasket: buildPricingAdapter("bigbasket", PRICE_COMMON),
};

export function getPricingAdapter(slug: PlatformSlug): PricingAdapter {
  const a = PRICING_ADAPTERS[slug];
  if (!a) throw new Error(`No pricing adapter for platform: ${slug}`);
  return a;
}

// ---------------- visibility / share of voice ----------------
interface VisCols {
  keyword: string[]; city?: string[]; date: string[]; brand: string[];
  sku?: string[]; rank: string[]; page?: string[]; sponsored?: string[];
}

function buildVisibilityAdapter(platform: PlatformSlug, cols: VisCols): VisibilityAdapter {
  return {
    platform,
    requiredColumns: [cols.keyword[0], cols.date[0], cols.brand[0], cols.rank[0]],
    parse(raw: RawRow[]): AdapterResult<NormalizedVisibilityRow> {
      const rows: NormalizedVisibilityRow[] = [];
      const errors: AdapterResult["errors"] = [];
      raw.forEach((r, i) => {
        const rowNum = i + 2;
        const keyword = pick(r, cols.keyword);
        const date = toDate(pick(r, cols.date));
        const observedBrand = pick(r, cols.brand);
        const rank = toNumber(pick(r, cols.rank));
        if (!keyword) return errors.push({ row: rowNum, message: "Missing keyword" });
        if (!date) return errors.push({ row: rowNum, message: "Missing or invalid date" });
        if (!observedBrand) return errors.push({ row: rowNum, message: "Missing brand" });
        if (rank == null || rank < 1) return errors.push({ row: rowNum, message: "Missing or invalid rank" });

        const page = cols.page ? toNumber(pick(r, cols.page)) ?? undefined : undefined;
        const sponsored = cols.sponsored ? toBool(pick(r, cols.sponsored)) ?? false : false;
        const cityName = (cols.city ? pick(r, cols.city) : undefined)?.trim() || "National";
        rows.push({
          keyword: keyword.trim(), cityName, date, observedBrand: observedBrand.trim(),
          skuCode: cols.sku ? pick(r, cols.sku)?.trim() : undefined,
          rank: Math.round(rank), page: page != null ? Math.round(page) : undefined, isSponsored: sponsored,
        });
      });
      return { rows, errors };
    },
  };
}

const VIS_COMMON = {
  keyword: ["Keyword", "keyword", "search_term", "Search Term", "query"],
  city: ["City", "city", "Location"],
  date: ["Date", "date", "Day"],
  brand: ["Brand", "brand", "Seller", "Advertiser"],
  sku: ["SKU Code", "sku_code", "sku", "Product"],
  rank: ["Rank", "rank", "Position", "position", "search_rank"],
  page: ["Page", "page", "Result Page"],
  sponsored: ["Sponsored", "sponsored", "is_sponsored", "Ad", "Type"],
};

export const VISIBILITY_ADAPTERS: Record<PlatformSlug, VisibilityAdapter> = {
  blinkit: buildVisibilityAdapter("blinkit", VIS_COMMON),
  zepto: buildVisibilityAdapter("zepto", VIS_COMMON),
  instamart: buildVisibilityAdapter("instamart", VIS_COMMON),
  bigbasket: buildVisibilityAdapter("bigbasket", VIS_COMMON),
};

export function getVisibilityAdapter(slug: PlatformSlug): VisibilityAdapter {
  const a = VISIBILITY_ADAPTERS[slug];
  if (!a) throw new Error(`No visibility adapter for platform: ${slug}`);
  return a;
}

// ---------------- products / SKU catalog ----------------
interface ProductCols {
  skuCode: string[]; name: string[]; packSize: string[]; mrp: string[]; category: string[]; platformProductId: string[];
}

function buildProductAdapter(platform: PlatformSlug, cols: ProductCols): ProductAdapter {
  return {
    platform,
    requiredColumns: [cols.skuCode[0], cols.name[0]],
    parse(raw: RawRow[]): AdapterResult<NormalizedProductRow> {
      const rows: NormalizedProductRow[] = [];
      const errors: AdapterResult["errors"] = [];
      raw.forEach((r, i) => {
        const rowNum = i + 2;
        const platformProductId = pick(r, cols.platformProductId)?.trim() || undefined;
        // Catalog exports often only carry the platform's item id; use it as the SKU code then.
        const skuCode = pick(r, cols.skuCode)?.trim() || platformProductId;
        const name = pick(r, cols.name)?.trim();
        if (!skuCode) return errors.push({ row: rowNum, message: "Missing SKU code" });
        if (!name) return errors.push({ row: rowNum, message: "Missing product name" });
        const mrp = toNumber(pick(r, cols.mrp)) ?? undefined;
        if (mrp != null && mrp < 0) return errors.push({ row: rowNum, message: "Negative MRP" });
        rows.push({
          skuCode, name: name.slice(0, 300), mrp, platformProductId,
          packSize: pick(r, cols.packSize)?.trim() || undefined,
          category: pick(r, cols.category)?.trim() || undefined,
        });
      });
      return { rows, errors };
    },
  };
}

const PRODUCT_COMMON: ProductCols = {
  skuCode: ["SKU Code", "sku_code", "sku", "SKU ID", "Item Code", "EAN", "Barcode"],
  name: ["Product Name", "product_name", "Item Name", "item_name", "Name", "Product", "Title"],
  packSize: ["Pack Size", "pack_size", "Unit", "UOM", "Weight", "Quantity", "Variant"],
  mrp: ["MRP", "mrp", "MRP (Rs)", "List Price", "Max Retail Price"],
  category: ["Category", "category", "Business Category", "L1 Category", "L2 Category", "Sub Category"],
  platformProductId: ["Item ID", "item_id", "Product ID", "product_id", "Platform Product ID", "Listing ID"],
};

export const PRODUCT_ADAPTERS: Record<PlatformSlug, ProductAdapter> = {
  blinkit: buildProductAdapter("blinkit", PRODUCT_COMMON),
  zepto: buildProductAdapter("zepto", PRODUCT_COMMON),
  instamart: buildProductAdapter("instamart", PRODUCT_COMMON),
  bigbasket: buildProductAdapter("bigbasket", PRODUCT_COMMON),
};

export function getProductAdapter(slug: PlatformSlug): ProductAdapter {
  const a = PRODUCT_ADAPTERS[slug];
  if (!a) throw new Error(`No product adapter for platform: ${slug}`);
  return a;
}
