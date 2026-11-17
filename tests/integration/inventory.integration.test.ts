import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB } from "../setup";
import { prisma } from "@/lib/db";
import { getAvailabilityAdapter, getPricingAdapter } from "@/lib/ingest/adapters";
import { ingestAvailability } from "@/lib/ingest/ingestAvailability";
import { ingestPricing } from "@/lib/ingest/ingestPricing";
import { aggregateBrand } from "@/lib/analytics/aggregate";
import { overview, availabilityByCity, oosTrend, pricingList } from "@/lib/analytics/queries";

let orgId: bigint, brandId: bigint;
const FROM = new Date("2026-09-01"), TO = new Date("2026-11-01");
const filter = () => ({ orgId, brandId, platformId: null, from: FROM, to: TO });

beforeAll(async () => {
  if (!HAS_DB) return;
  await prisma.platform.upsert({ where: { slug: "blinkit" }, create: { slug: "blinkit", name: "Blinkit" }, update: {} });
  const org = await prisma.organization.create({ data: { name: `InvOrg ${Date.now()}` } });
  orgId = org.id;
  const brand = await prisma.brand.create({ data: { orgId, name: "InvBrand" } });
  brandId = brand.id;
  await prisma.sku.createMany({ data: [{ brandId, name: "A", skuCode: "CF-A" }, { brandId, name: "B", skuCode: "CF-B" }] });

  // availability: Mumbai A 8/10, B 0/10 (OOS); Pune A 10/10
  await ingestAvailability({ orgId, brandId, platformSlug: "blinkit", source: "CSV" },
    getAvailabilityAdapter("blinkit").parse([
      { "SKU Code": "CF-A", "City": "Mumbai", "Date": "2026-10-01", "Stores Total": "10", "Stores In Stock": "8" },
      { "SKU Code": "CF-B", "City": "Mumbai", "Date": "2026-10-01", "Stores Total": "10", "Stores In Stock": "0" },
      { "SKU Code": "CF-A", "City": "Pune", "Date": "2026-10-01", "Stores Total": "10", "Stores In Stock": "10" },
    ]));
  await aggregateBrand(orgId, brandId);

  // pricing
  await ingestPricing({ orgId, brandId, platformSlug: "blinkit", source: "CSV" },
    getPricingAdapter("blinkit").parse([
      { "SKU Code": "CF-A", "Date": "2026-10-01", "MRP": "100", "Selling Price": "80" },
    ]));
});

afterAll(async () => {
  if (!HAS_DB) return;
  await prisma.analyticsDaily.deleteMany({ where: { orgId } });
  await prisma.importJob.deleteMany({ where: { orgId } });
  await prisma.brand.deleteMany({ where: { orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.$disconnect();
});

describe.skipIf(!HAS_DB)("availability ingestion & aggregation", () => {
  it("rolls availability + OOS into overview", async () => {
    const o = await overview(filter());
    // availability: (80 + 0 + 100) / 3 = 60
    expect(o.availabilityPct).toBeCloseTo(60, 1);
    // OOS: 1 of 3 observations = 33.3%
    expect(o.oosPct).toBeCloseTo(33.3, 1);
  });

  it("returns availability by city", async () => {
    const cities = await availabilityByCity(filter());
    const pune = cities.find((c) => c.city === "Pune");
    const mumbai = cities.find((c) => c.city === "Mumbai");
    expect(pune?.availability).toBeCloseTo(100, 1);
    expect(mumbai?.availability).toBeCloseTo(40, 1); // (80 + 0)/2
  });

  it("returns an OOS trend point", async () => {
    const t = await oosTrend(filter());
    expect(t.length).toBeGreaterThanOrEqual(1);
  });

  it("is idempotent when re-aggregated", async () => {
    await aggregateBrand(orgId, brandId);
    const o = await overview(filter());
    expect(o.availabilityPct).toBeCloseTo(60, 1);
  });
});

describe.skipIf(!HAS_DB)("pricing ingestion", () => {
  it("lists latest price with computed discount", async () => {
    const items = await pricingList(filter());
    const a = items.find((r) => r.skuCode === "CF-A");
    expect(a?.sellingPrice).toBe(80);
    expect(a?.mrp).toBe(100);
    expect(a?.discountPct).toBe(20);
  });
});
