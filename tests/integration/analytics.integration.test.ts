import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB } from "../setup";
import { prisma } from "@/lib/db";
import { getAdapter } from "@/lib/ingest/adapters";
import { ingestSales } from "@/lib/ingest/ingestSales";
import { aggregateBrand } from "@/lib/analytics/aggregate";
import { overview, trend, platformBreakdown, skuPerformance } from "@/lib/analytics/queries";

let orgId: bigint, otherOrgId: bigint, brandId: bigint;
const FROM = new Date("2026-09-01"), TO = new Date("2026-11-01");

beforeAll(async () => {
  if (!HAS_DB) return;
  await prisma.platform.upsert({ where: { slug: "blinkit" }, create: { slug: "blinkit", name: "Blinkit" }, update: {} });
  const org = await prisma.organization.create({ data: { name: `AnOrg ${Date.now()}` } });
  const other = await prisma.organization.create({ data: { name: `OtherOrg ${Date.now()}` } });
  orgId = org.id; otherOrgId = other.id;
  const brand = await prisma.brand.create({ data: { orgId, name: "AnBrand" } });
  brandId = brand.id;
  await prisma.sku.createMany({ data: [
    { brandId, name: "A", skuCode: "CF-A" }, { brandId, name: "B", skuCode: "CF-B" },
  ]});
  const parsed = getAdapter("blinkit").parse([
    { "SKU Code": "CF-A", "Date": "2026-10-01", "GMV": "1000", "Units Sold": "10" },
    { "SKU Code": "CF-A", "Date": "2026-10-01", "GMV": "500", "Units Sold": "5" },
    { "SKU Code": "CF-B", "Date": "2026-10-01", "GMV": "800", "Units Sold": "8" },
  ]);
  await ingestSales({ orgId, brandId, platformSlug: "blinkit", source: "CSV" }, parsed);
  await aggregateBrand(orgId, brandId);
});

afterAll(async () => {
  if (!HAS_DB) return;
  await prisma.analyticsDaily.deleteMany({ where: { orgId } });
  await prisma.importJob.deleteMany({ where: { orgId } });
  await prisma.brand.deleteMany({ where: { orgId } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
  await prisma.$disconnect();
});

describe.skipIf(!HAS_DB)("analytics aggregation & queries", () => {
  const filter = () => ({ orgId, brandId, platformId: null, from: FROM, to: TO });

  it("overview sums gmv/units and computes blended ASP", async () => {
    const o = await overview(filter());
    expect(o.gmv).toBe(2300);      // 1500 (A merged) + 800 (B)
    expect(o.units).toBe(23);      // 15 + 8
    expect(o.avgSellPrice).toBe(100); // 2300 / 23
  });

  it("platform breakdown attributes 100% to blinkit", async () => {
    const p = await platformBreakdown(filter());
    expect(p).toHaveLength(1);
    expect(p[0].platform).toBe("blinkit");
    expect(p[0].gmv).toBe(2300);
    expect(p[0].share).toBe(100);
  });

  it("trend has one date with the day's total", async () => {
    const t = await trend(filter());
    expect(t).toHaveLength(1);
    expect(Number(t[0].blinkit)).toBe(2300);
  });

  it("sku performance ranks CF-A first", async () => {
    const s = await skuPerformance(filter());
    expect(s[0].skuCode).toBe("CF-A");
    expect(s[0].gmv).toBe(1500);
  });

  it("is tenant-isolated: another org sees nothing", async () => {
    const o = await overview({ orgId: otherOrgId, brandId: null, platformId: null, from: FROM, to: TO });
    expect(o.gmv).toBe(0);
    expect(o.units).toBe(0);
  });

  it("re-aggregating is idempotent (no double count)", async () => {
    await aggregateBrand(orgId, brandId);
    const o = await overview(filter());
    expect(o.gmv).toBe(2300);
  });
});
