import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB } from "../setup";
import { prisma } from "@/lib/db";
import { getVisibilityAdapter } from "@/lib/ingest/adapters";
import { ingestVisibility } from "@/lib/ingest/ingestVisibility";
import { aggregateBrand } from "@/lib/analytics/aggregate";
import { overview, sovAnalytics, keywordRanking } from "@/lib/analytics/queries";

let orgId: bigint, brandId: bigint;
const FROM = new Date("2026-09-01"), TO = new Date("2026-11-01");
const filter = () => ({ orgId, brandId, platformId: null, from: FROM, to: TO });

beforeAll(async () => {
  if (!HAS_DB) return;
  await prisma.platform.upsert({ where: { slug: "blinkit" }, create: { slug: "blinkit", name: "Blinkit" }, update: {} });
  const org = await prisma.organization.create({ data: { name: `VisOrg ${Date.now()}` } });
  orgId = org.id;
  const brand = await prisma.brand.create({ data: { orgId, name: "Crunchee" } });
  brandId = brand.id;

  // keyword "chips": Crunchee rank2, RivalCo rank1, SnackCo rank3  → own share 1/3
  // keyword "cola": Crunchee rank1, RivalCo rank2                 → own share 1/2
  await ingestVisibility({ orgId, brandId, platformSlug: "blinkit", source: "CSV" },
    getVisibilityAdapter("blinkit").parse([
      { "Keyword": "chips", "Date": "2026-10-01", "Brand": "Crunchee", "Rank": "2", "Sponsored": "yes" },
      { "Keyword": "chips", "Date": "2026-10-01", "Brand": "RivalCo", "Rank": "1" },
      { "Keyword": "chips", "Date": "2026-10-01", "Brand": "SnackCo", "Rank": "3" },
      { "Keyword": "cola", "Date": "2026-10-01", "Brand": "Crunchee", "Rank": "1" },
      { "Keyword": "cola", "Date": "2026-10-01", "Brand": "RivalCo", "Rank": "2" },
    ]));
  await aggregateBrand(orgId, brandId);
});

afterAll(async () => {
  if (!HAS_DB) return;
  await prisma.visibilityObservation.deleteMany({ where: { orgId } });
  await prisma.analyticsDaily.deleteMany({ where: { orgId } });
  await prisma.importJob.deleteMany({ where: { orgId } });
  await prisma.keyword.deleteMany({ where: { brandId } });
  await prisma.brand.deleteMany({ where: { orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.$disconnect();
});

describe.skipIf(!HAS_DB)("visibility ingestion & SOV", () => {
  it("computes observation-based SOV (2 of 5 observations are ours = 40%)", async () => {
    const s = await sovAnalytics(filter());
    expect(s.sovPct).toBeCloseTo(40, 1);
    expect(s.coverage.keywords).toBe(2);
    expect(s.coverage.observations).toBe(5);
    const own = s.donut.find((d) => d.isOwn);
    expect(own?.brand).toBe("Crunchee");
  });

  it("rolls SOV into overview", async () => {
    const o = await overview(filter());
    expect(o.sovPct).toBeCloseTo(40, 1);
  });

  it("keyword ranking shows our best rank and per-keyword SOV", async () => {
    const kw = await keywordRanking(filter());
    const cola = kw.find((k) => k.keyword === "cola");
    const chips = kw.find((k) => k.keyword === "chips");
    expect(cola?.bestRank).toBe(1);
    expect(cola?.sovPct).toBeCloseTo(50, 1);
    expect(chips?.sovPct).toBeCloseTo(33.3, 1);
    expect(chips?.sponsoredHits).toBe(1);
  });

  it("is idempotent on re-import (no duplicate observations)", async () => {
    const before = await prisma.visibilityObservation.count({ where: { orgId } });
    await ingestVisibility({ orgId, brandId, platformSlug: "blinkit", source: "CSV" },
      getVisibilityAdapter("blinkit").parse([
        { "Keyword": "chips", "Date": "2026-10-01", "Brand": "Crunchee", "Rank": "2", "Sponsored": "yes" },
      ]));
    const after = await prisma.visibilityObservation.count({ where: { orgId } });
    expect(after).toBe(before);
  });

  it("is tenant-isolated", async () => {
    const other = await prisma.organization.create({ data: { name: `Other ${Date.now()}` } });
    const s = await sovAnalytics({ orgId: other.id, brandId: null, platformId: null, from: FROM, to: TO });
    expect(s.sovPct).toBeNull();
    expect(s.coverage.observations).toBe(0);
    await prisma.organization.deleteMany({ where: { id: other.id } });
  });
});
