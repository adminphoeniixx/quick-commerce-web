import { z } from "zod";

export const platformSchema = z.enum(["BLINKIT", "ZEPTO", "INSTAMART", "AUTHORIZED_FEED"]);
export type Platform = z.infer<typeof platformSchema>;

export const locationSchema = z.object({
  city: z.string().trim().min(2).max(120),
  locationKey: z.string().trim().min(2).max(200),
});

export const searchSchema = z.object({
  authorization: z.string().min(20),
  organizationId: z.string().regex(/^\d+$/),
  platform: platformSchema,
  keyword: z.string().trim().min(1).max(160),
  location: locationSchema,
  category: z.string().trim().max(120).optional(),
  maxResults: z.number().int().min(1).max(100).default(25),
});

export const observationSchema = z.object({
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
});

export type SearchInput = z.infer<typeof searchSchema>;
export type Observation = z.infer<typeof observationSchema>;

export type AdapterResult =
  | { supported: true; observations: Observation[]; coverage: { requested: number; returned: number }; errors: string[] }
  | { supported: false; code: "UNSUPPORTED_WITHOUT_WRITTEN_AUTHORIZATION" | "PROVIDER_NOT_CONFIGURED"; reason: string };

export interface MarketplaceAdapter {
  readonly platform: Platform;
  checkAvailability(): Promise<{ healthy: boolean; code: string; message: string }>;
  searchProducts(input: SearchInput): Promise<AdapterResult>;
}
