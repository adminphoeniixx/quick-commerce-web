import { z } from "zod";

export const platformCode = z.enum(["BLINKIT", "ZEPTO", "INSTAMART", "AUTHORIZED_FEED"]);
export const authorizedObservationBatch = z.object({
  organizationId: z.string().regex(/^\d+$/),
  platform: platformCode,
  collectionType: z.enum(["SEARCH", "PRODUCT", "CATEGORY"]),
  keyword: z.string().trim().min(1).max(160).optional(),
  city: z.string().trim().min(2).max(120),
  locationKey: z.string().trim().min(2).max(200),
  observations: z.array(z.object({
    platformProductId: z.string().trim().min(1).max(240),
    productUrl: z.string().url().max(2048),
    title: z.string().trim().min(1).max(500),
    brand: z.string().trim().max(160).optional(),
    category: z.string().trim().max(160).optional(),
    subcategory: z.string().trim().max(160).optional(),
    imageUrl: z.string().url().max(2048).optional(),
    packSize: z.string().trim().max(100).optional(),
    unit: z.string().trim().max(40).optional(),
    sellingPrice: z.number().nonnegative().finite(),
    mrp: z.number().nonnegative().finite().optional(),
    availability: z.enum(["IN_STOCK", "OUT_OF_STOCK", "UNKNOWN"]),
    rank: z.number().int().positive().optional(),
    placementType: z.enum(["ORGANIC", "SPONSORED", "UNKNOWN"]).default("UNKNOWN"),
    observedAt: z.string().datetime(),
    sourceUrl: z.string().url().max(2048),
  })).min(1).max(1000),
});

export function normalizeProductTitle(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
