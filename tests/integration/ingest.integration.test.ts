import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { HAS_DB } from "../setup";
import { prisma } from "@/lib/db";
import { getAdapter } from "@/lib/ingest/adapters";
import { ingestSales } from "@/lib/ingest/ingestSales";

let orgId: bigint, brandId: bigint;
const cleanup: { listings: bigint[] } = { listings: [] };

beforeAll(async () => {
  if (!HAS_DB) return;
  // ensure platforms seeded
  await prisma.platform.upsert({ where: { slug: "blinkit" }, create: { slug: "blinkit", name: "Blinkit" }, update: {} });
  const org = await prisma.organization.create({ data: { name: `IngestOrg ${Date.now()}` } });
  orgId = org.id;
  const brand = await prisma.brand.create({ data: { orgId, name: "IngestBrand" } });
  brandId = brand.id;
  await prisma.sku.createMany({ data: [
    { brandId, name: "A", skuCode: "CF-A" },
    { brandId, name: "B", skuCode: "CF-B" },
  ]});
});

afterAll(async () => {
  if (!HAS_DB) return;
  // children cascade from brand/org deletes
  await prisma.importError.deleteMany({ where: { importJob: { orgId } } });
  await prisma.importJob.deleteMany({ where: { orgId } });
  await prisma.brand.deleteMany({ where: { orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.$disconnect();
});

const RAW = [
  { "SKU Code": "CF-A", "Date": "2026-10-01", "GMV": "1000", "Units Sold": "10" },
  { "SKU Code": "CF-A", "Date": "2026-10-01", "GMV": "500", "Units Sold": "5" },   // duplicate → merge (sum)
  { "SKU Code": "CF-B", "Date": "2026-10-01", "GMV": "800", "Units Sold": "8" },
  { "SKU Code": "CF-X", "Date": "2026-10-01", "GMV": "100", "Units Sold": "1" },   // unknown sku → error
];

describe.skipIf(!HAS_DB)("sales ingestion", () => {
  it("merges duplicates, flags unknown SKU, and writes facts", async () => {
    const parsed = getAdapter("blinkit").parse(RAW);
    const res = await ingestSales({ orgId, brandId, platformSlug: "blinkit", source: "CSV", fileName: "t.csv" }, parsed);

    expect(res.duplicatesMerged).toBe(1);
    expect(res.rowsOk).toBe(2);        // CF-A (merged) + CF-B
    expect(res.rowsFailed).toBe(1);    // CF-X unknown

    // CF-A merged: gmv 1500, units 15
    const skuA = await prisma.sku.findFirstOrThrow({ where: { brandId, skuCode: "CF-A" } });
    const listingA = await prisma.platformListing.findFirstOrThrow({ where: { skuId: skuA.id } });
    const mA = await prisma.dailyMetric.findFirstOrThrow({ where: { listingId: listingA.id } });
    expect(Number(mA.gmv)).toBe(1500);
    expect(mA.unitsSold).toBe(15);
  });

  it("is idempotent: re-running the same file does not duplicate or double", async () => {
    const before = await prisma.dailyMetric.count({ where: { listing: { sku: { brandId } } } });
    const parsed = getAdapter("blinkit").parse(RAW);
    await ingestSales({ orgId, brandId, platformSlug: "blinkit", source: "CSV", fileName: "t.csv" }, parsed);
    const after = await prisma.dailyMetric.count({ where: { listing: { sku: { brandId } } } });
    expect(after).toBe(before); // same number of fact rows

    const skuA = await prisma.sku.findFirstOrThrow({ where: { brandId, skuCode: "CF-A" } });
    const listingA = await prisma.platformListing.findFirstOrThrow({ where: { skuId: skuA.id } });
    const mA = await prisma.dailyMetric.findFirstOrThrow({ where: { listingId: listingA.id } });
    expect(Number(mA.gmv)).toBe(1500); // value unchanged, not doubled
  });
});
