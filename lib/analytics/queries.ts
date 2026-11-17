// Tenant-scoped analytics reads over AnalyticsDaily (rollup) and DailyMetric
// (SKU-level). Every function requires an orgId and filters by it — callers
// resolve orgId from the session and verify membership before calling.
import { prisma } from "@/lib/db";
import type { PlatformSlug } from "@/lib/types";

export interface Filter {
  orgId: bigint;
  brandId?: bigint | null;
  platformId?: number | null;
  cityId?: number | null;
  category?: string | null;
  from: Date;
  to: Date;
}

const SLUGS: Record<number, PlatformSlug> = {}; // id → slug cache
async function platformSlug(id: number): Promise<string> {
  if (SLUGS[id]) return SLUGS[id];
  const rows = await prisma.platform.findMany({ select: { id: true, slug: true } });
  rows.forEach((p) => (SLUGS[p.id] = p.slug as PlatformSlug));
  return SLUGS[id] ?? String(id);
}

export async function resolvePlatformId(slug?: string | null): Promise<number | null> {
  if (!slug || slug === "ALL") return null;
  const p = await prisma.platform.findUnique({ where: { slug }, select: { id: true } });
  return p?.id ?? null;
}

function whereOf(f: Filter) {
  return {
    orgId: f.orgId,
    ...(f.brandId ? { brandId: f.brandId } : {}),
    ...(f.platformId ? { platformId: f.platformId } : {}),
    date: { gte: f.from, lte: f.to },
  };
}

export interface ComparisonMetric { current: number | null; previous: number | null; absoluteChange: number | null; percentChange: number | null }
const comparisonMetric = (current: number | null, previous: number | null): ComparisonMetric => ({
  current, previous,
  absoluteChange: current == null || previous == null ? null : Math.round((current - previous) * 100) / 100,
  percentChange: current == null || previous == null || previous === 0 ? null : Math.round(((current - previous) / previous) * 1000) / 10,
});

/** Complete current/previous-period comparison. Null means no observation. */
export async function periodComparison(f: Filter) {
  const days = Math.max(1, Math.round((f.to.getTime() - f.from.getTime()) / 86400000) + 1);
  const previous = { ...f, from: new Date(f.from.getTime() - days * 86400000), to: new Date(f.to.getTime() - days * 86400000) };
  const aggregate = (x: Filter) => prisma.analyticsDaily.aggregate({
    _sum: { gmv: true, units: true }, _avg: { availabilityPct: true, oosPct: true, sovPct: true }, where: whereOf(x),
  });
  const [cur, prev, curCount, prevCount, curTrend, prevTrend] = await Promise.all([
    aggregate(f), aggregate(previous), prisma.analyticsDaily.count({ where: whereOf(f) }), prisma.analyticsDaily.count({ where: whereOf(previous) }), trend(f), trend(previous),
  ]);
  // Null averages mean "no observations" and must stay null, never 0.
  const val = (count: number, value: unknown) => (count && value != null ? Number(value) : null);
  return {
    currentRange: { from: f.from.toISOString().slice(0,10), to: f.to.toISOString().slice(0,10) },
    previousRange: { from: previous.from.toISOString().slice(0,10), to: previous.to.toISOString().slice(0,10) },
    metrics: {
      gmv: comparisonMetric(val(curCount, cur._sum.gmv), val(prevCount, prev._sum.gmv)),
      units: comparisonMetric(val(curCount, cur._sum.units), val(prevCount, prev._sum.units)),
      availabilityPct: comparisonMetric(val(curCount, cur._avg.availabilityPct), val(prevCount, prev._avg.availabilityPct)),
      oosPct: comparisonMetric(val(curCount, cur._avg.oosPct), val(prevCount, prev._avg.oosPct)),
      sovPct: comparisonMetric(val(curCount, cur._avg.sovPct), val(prevCount, prev._avg.sovPct)),
    },
    currentTrend: curTrend, previousTrend: prevTrend,
  };
}

/** Category facts are queried independently to avoid multiplying grains. */
export async function categoryAnalytics(f: Filter) {
  const brandSql = f.brandId ? Prisma.sql`AND s."brandId" = ${f.brandId}` : Prisma.empty;
  const platformSql = f.platformId ? Prisma.sql`AND pl."platformId" = ${f.platformId}` : Prisma.empty;
  const categorySql = f.category ? Prisma.sql`AND COALESCE(NULLIF(s.category,''), 'Uncategorized') = ${f.category}` : Prisma.empty;
  const citySql = f.cityId ? Prisma.sql`AND a."cityId" = ${f.cityId}` : Prisma.empty;
  const priceCitySql = f.cityId ? Prisma.sql`AND ps."cityId" = ${f.cityId}` : Prisma.empty;
  type Sales = { category:string;gmv:string;units:number };
  type Avail = { category:string;availability:number;oos:number };
  type Price = { category:string;price:number };
  type Vis = { category:string;sov:number };
  const [sales, availability, pricing, visibility] = await Promise.all([
    prisma.$queryRaw<Sales[]>`SELECT COALESCE(NULLIF(s.category,''), 'Uncategorized') category, SUM(dm.gmv)::text gmv, SUM(dm."unitsSold")::int units FROM "DailyMetric" dm JOIN "PlatformListing" pl ON pl.id=dm."listingId" JOIN "Sku" s ON s.id=pl."skuId" JOIN "Brand" b ON b.id=s."brandId" WHERE b."orgId"=${f.orgId} ${brandSql} ${platformSql} ${categorySql} AND dm."metricDate" BETWEEN ${f.from} AND ${f.to} GROUP BY 1`,
    prisma.$queryRaw<Avail[]>`SELECT COALESCE(NULLIF(s.category,''), 'Uncategorized') category, AVG(a."availabilityPct")::float availability, (100.0*AVG(CASE WHEN a."isOos" THEN 1 ELSE 0 END))::float oos FROM "AvailabilitySnapshot" a JOIN "PlatformListing" pl ON pl.id=a."listingId" JOIN "Sku" s ON s.id=pl."skuId" JOIN "Brand" b ON b.id=s."brandId" WHERE b."orgId"=${f.orgId} ${brandSql} ${platformSql} ${categorySql} ${citySql} AND a."snapshotDate" BETWEEN ${f.from} AND ${f.to} GROUP BY 1`,
    prisma.$queryRaw<Price[]>`SELECT COALESCE(NULLIF(s.category,''), 'Uncategorized') category, AVG(ps."sellingPrice")::float price FROM "PricingSnapshot" ps JOIN "PlatformListing" pl ON pl.id=ps."listingId" JOIN "Sku" s ON s.id=pl."skuId" JOIN "Brand" b ON b.id=s."brandId" WHERE b."orgId"=${f.orgId} ${brandSql} ${platformSql} ${categorySql} ${priceCitySql} AND ps."snapshotDate" BETWEEN ${f.from} AND ${f.to} GROUP BY 1`,
    prisma.$queryRaw<Vis[]>`SELECT COALESCE(NULLIF(s.category,''), 'Uncategorized') category, (100.0*SUM(CASE WHEN v."isOwn" THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0))::float sov FROM "VisibilityObservation" v JOIN "Brand" b ON b.id=v."brandId" LEFT JOIN "Sku" s ON s."brandId"=b.id AND s."skuCode"=v."skuCode" WHERE b."orgId"=${f.orgId} ${f.brandId ? Prisma.sql`AND v."brandId"=${f.brandId}` : Prisma.empty} ${f.platformId ? Prisma.sql`AND v."platformId"=${f.platformId}` : Prisma.empty} ${f.cityId ? Prisma.sql`AND v."cityId"=${f.cityId}` : Prisma.empty} ${f.category ? Prisma.sql`AND COALESCE(NULLIF(s.category,''), 'Uncategorized')=${f.category}` : Prisma.empty} AND v."snapshotDate" BETWEEN ${f.from} AND ${f.to} GROUP BY 1`,
  ]);
  const categories = new Set([...sales,...availability,...pricing,...visibility].map(x=>x.category));
  return [...categories].sort().map(category => ({ category,
    gmv: sales.find(x=>x.category===category) ? Number(sales.find(x=>x.category===category)!.gmv) : null,
    units: sales.find(x=>x.category===category)?.units ?? null,
    availabilityPct: availability.find(x=>x.category===category)?.availability ?? null,
    oosPct: availability.find(x=>x.category===category)?.oos ?? null,
    avgSellingPrice: pricing.find(x=>x.category===category)?.price ?? null,
    sovPct: visibility.find(x=>x.category===category)?.sov ?? null,
  }));
}

function num(v: unknown): number {
  return v == null ? 0 : Number(v);
}

export async function overview(f: Filter) {
  const spanMs = f.to.getTime() - f.from.getTime();
  const prevFrom = new Date(f.from.getTime() - spanMs - 86400000);
  const prevTo = new Date(f.from.getTime() - 86400000);

  const [cur, prev] = await Promise.all([
    prisma.analyticsDaily.aggregate({ _sum: { gmv: true, units: true }, _avg: { availabilityPct: true, oosPct: true, sovPct: true }, where: whereOf(f) }),
    prisma.analyticsDaily.aggregate({ _sum: { gmv: true, units: true }, where: whereOf({ ...f, from: prevFrom, to: prevTo }) }),
  ]);

  const gmv = num(cur._sum.gmv), units = num(cur._sum.units);
  const pGmv = num(prev._sum.gmv), pUnits = num(prev._sum.units);
  const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null);
  const round1 = (v: unknown) => (v == null ? null : Math.round(Number(v) * 10) / 10);

  return {
    gmv, units,
    avgSellPrice: units > 0 ? Math.round((gmv / units) * 100) / 100 : null,
    deltaGmvPct: pct(gmv, pGmv),
    deltaUnitsPct: pct(units, pUnits),
    availabilityPct: round1(cur._avg.availabilityPct),
    oosPct: round1(cur._avg.oosPct),
    sovPct: round1(cur._avg.sovPct),
  };
}

// Average availability % per city over the range (brand/platform scoped).
export async function availabilityByCity(f: Filter) {
  const rows = await prisma.$queryRaw<Array<{ city: string; avail: number }>>`
    SELECT c.name AS city, AVG(a."availabilityPct")::float AS avail
    FROM "AvailabilitySnapshot" a
    JOIN "City" c ON c.id = a."cityId"
    JOIN "PlatformListing" pl ON pl.id = a."listingId"
    JOIN "Sku" s ON s.id = pl."skuId"
    WHERE s."brandId" IN (SELECT id FROM "Brand" WHERE "orgId" = ${f.orgId} ${f.brandId ? prismaBrand(f.brandId) : empty()})
      ${f.platformId ? prismaPlatform(f.platformId) : empty()}
      AND a."snapshotDate" BETWEEN ${f.from} AND ${f.to}
    GROUP BY c.name
    ORDER BY avail DESC`;
  return rows.map((r) => ({ city: r.city, availability: Math.round(r.avail * 10) / 10 }));
}

// Daily out-of-stock rate across platforms (from the rollup).
export async function oosTrend(f: Filter) {
  const rows = await prisma.analyticsDaily.groupBy({
    by: ["date"], _avg: { oosPct: true },
    where: { ...whereOf(f), oosPct: { not: null } },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), oosPct: r._avg.oosPct != null ? Math.round(Number(r._avg.oosPct) * 10) / 10 : 0 }));
}

// Latest price per SKU × platform within the range (MRP vs SP, discount).
export async function pricingList(f: Filter, limit = 100) {
  const rows = await prisma.$queryRaw<Array<{
    skuCode: string; name: string; platformId: number; sellingPrice: string; mrp: string | null; discountPct: string | null;
  }>>`
    SELECT DISTINCT ON (s."skuCode", pl."platformId")
           s."skuCode" AS "skuCode", s.name AS name, pl."platformId" AS "platformId",
           ps."sellingPrice"::text AS "sellingPrice", ps.mrp::text AS mrp, ps."discountPct"::text AS "discountPct"
    FROM "PricingSnapshot" ps
    JOIN "PlatformListing" pl ON pl.id = ps."listingId"
    JOIN "Sku" s ON s.id = pl."skuId"
    WHERE s."brandId" IN (SELECT id FROM "Brand" WHERE "orgId" = ${f.orgId} ${f.brandId ? prismaBrand(f.brandId) : empty()})
      ${f.platformId ? prismaPlatform(f.platformId) : empty()}
      AND ps."snapshotDate" BETWEEN ${f.from} AND ${f.to}
    ORDER BY s."skuCode", pl."platformId", ps."snapshotDate" DESC
    LIMIT ${limit}`;
  return Promise.all(rows.map(async (r) => ({
    skuCode: r.skuCode, name: r.name, platform: await platformSlug(r.platformId),
    sellingPrice: Number(r.sellingPrice),
    mrp: r.mrp != null ? Number(r.mrp) : null,
    discountPct: r.discountPct != null ? Math.round(Number(r.discountPct) * 10) / 10 : null,
  })));
}

export async function trend(f: Filter) {
  const rows = await prisma.analyticsDaily.groupBy({
    by: ["date", "platformId"],
    _sum: { gmv: true },
    where: whereOf(f),
    orderBy: { date: "asc" },
  });
  // pivot date → { date, <slug>: gmv }
  const byDate = new Map<string, Record<string, number | string>>();
  for (const r of rows) {
    const key = r.date.toISOString().slice(0, 10);
    const slug = await platformSlug(r.platformId);
    const entry = byDate.get(key) ?? { date: key };
    entry[slug] = num(r._sum.gmv);
    byDate.set(key, entry);
  }
  // Days after the last day with sales only carry stock/price snapshots (e.g. today's
  // inventory sync); drop them so the trend doesn't show a false fall to zero.
  const points = [...byDate.values()];
  const hasSales = (p: Record<string, number | string>) => Object.entries(p).some(([k, v]) => k !== "date" && Number(v) > 0);
  let end = points.length;
  while (end > 0 && !hasSales(points[end - 1])) end--;
  return points.slice(0, end);
}

export async function platformBreakdown(f: Filter) {
  const rows = await prisma.analyticsDaily.groupBy({
    by: ["platformId"], _sum: { gmv: true, units: true }, where: whereOf(f),
  });
  const total = rows.reduce((s, r) => s + num(r._sum.gmv), 0);
  const out = await Promise.all(rows.map(async (r) => ({
    platform: await platformSlug(r.platformId),
    gmv: num(r._sum.gmv),
    units: num(r._sum.units),
    share: total > 0 ? Math.round((num(r._sum.gmv) / total) * 1000) / 10 : 0,
  })));
  return out.sort((a, b) => b.gmv - a.gmv);
}

export async function skuPerformance(f: Filter, limit = 50) {
  const rows = await prisma.$queryRaw<Array<{
    skuCode: string; name: string; platformId: number; gmv: string; units: number; avgPrice: string | null;
  }>>`
    SELECT s."skuCode" AS "skuCode", s.name AS name, pl."platformId" AS "platformId",
           SUM(dm.gmv)::text AS gmv, SUM(dm."unitsSold")::int AS units,
           (SUM(dm.gmv) / NULLIF(SUM(dm."unitsSold"),0))::text AS "avgPrice"
    FROM "DailyMetric" dm
    JOIN "PlatformListing" pl ON pl.id = dm."listingId"
    JOIN "Sku" s ON s.id = pl."skuId"
    WHERE s."brandId" IN (SELECT id FROM "Brand" WHERE "orgId" = ${f.orgId} ${f.brandId ? prismaBrand(f.brandId) : empty()})
      ${f.platformId ? prismaPlatform(f.platformId) : empty()}
      AND dm."metricDate" BETWEEN ${f.from} AND ${f.to}
    GROUP BY s."skuCode", s.name, pl."platformId"
    ORDER BY SUM(dm.gmv) DESC
    LIMIT ${limit}`;
  return Promise.all(rows.map(async (r) => ({
    skuCode: r.skuCode, name: r.name,
    platform: await platformSlug(r.platformId),
    gmv: Number(r.gmv), units: Number(r.units),
    avgPrice: r.avgPrice ? Math.round(Number(r.avgPrice) * 100) / 100 : null,
  })));
}

// ================= Visibility / Share of Voice =================
// SOV here is an OBSERVATION-BASED visibility share (not impression share):
//   SOV% = 100 × (observations attributed to our brand) / (all observations in scope).
// Coverage metadata is returned so the basis of the share is explicit.

function visWhere(f: Filter) {
  return {
    orgId: f.orgId,
    ...(f.brandId ? { brandId: f.brandId } : {}),
    ...(f.platformId ? { platformId: f.platformId } : {}),
    snapshotDate: { gte: f.from, lte: f.to },
  };
}
// `p` is a column prefix such as Prisma.raw('v.') to disambiguate joined queries.
function visWhereSql(f: Filter, p = Prisma.empty) {
  return Prisma.sql`${p}"orgId" = ${f.orgId}
    ${f.brandId ? Prisma.sql` AND ${p}"brandId" = ${f.brandId}` : Prisma.empty}
    ${f.platformId ? Prisma.sql` AND ${p}"platformId" = ${f.platformId}` : Prisma.empty}
    AND ${p}"snapshotDate" BETWEEN ${f.from} AND ${f.to}`;
}

export async function sovAnalytics(f: Filter) {
  const where = visWhere(f);

  const [brandGroups, sponsoredGroups, cov] = await Promise.all([
    prisma.visibilityObservation.groupBy({ by: ["observedBrand", "isOwn"], _count: { _all: true }, where }),
    prisma.visibilityObservation.groupBy({ by: ["isSponsored"], _count: { _all: true }, where: { ...where, isOwn: true } }),
    prisma.$queryRaw<Array<{ kw: number; cities: number; platforms: number; obs: number; f: Date | null; t: Date | null }>>`
      SELECT COUNT(DISTINCT "keywordId")::int AS kw, COUNT(DISTINCT "cityId")::int AS cities,
             COUNT(DISTINCT "platformId")::int AS platforms, COUNT(*)::int AS obs,
             MIN("snapshotDate") AS f, MAX("snapshotDate") AS t
      FROM "VisibilityObservation" WHERE ${visWhereSql(f)}`,
  ]);

  const total = brandGroups.reduce((s, g) => s + g._count._all, 0);
  const donut = brandGroups
    .map((g) => ({ brand: g.observedBrand, isOwn: g.isOwn, count: g._count._all, share: total > 0 ? Math.round((g._count._all / total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.count - a.count);

  const trendRows = await prisma.$queryRaw<Array<{ date: Date; sov: number }>>`
    SELECT "snapshotDate" AS date,
           (100.0 * SUM(CASE WHEN "isOwn" THEN 1 ELSE 0 END) / COUNT(*))::float AS sov
    FROM "VisibilityObservation" WHERE ${visWhereSql(f)}
    GROUP BY "snapshotDate" ORDER BY "snapshotDate" ASC`;

  const spon = sponsoredGroups.find((g) => g.isSponsored)?._count._all ?? 0;
  const org = sponsoredGroups.find((g) => !g.isSponsored)?._count._all ?? 0;
  const c = cov[0];

  return {
    sovPct: total > 0 ? Math.round((donut.filter((d) => d.isOwn).reduce((s, d) => s + d.count, 0) / total) * 1000) / 10 : null,
    donut,
    trend: trendRows.map((r) => ({ date: r.date.toISOString().slice(0, 10), sovPct: Math.round(r.sov * 10) / 10 })),
    organicVsSponsored: { organic: org, sponsored: spon },
    coverage: {
      keywords: c?.kw ?? 0, cities: c?.cities ?? 0, platforms: c?.platforms ?? 0, observations: c?.obs ?? 0,
      from: c?.f ? c.f.toISOString().slice(0, 10) : null, to: c?.t ? c.t.toISOString().slice(0, 10) : null,
      basis: "observation-based visibility share",
    },
  };
}

export async function keywordRanking(f: Filter, limit = 100) {
  const rows = await prisma.$queryRaw<Array<{
    term: string; bestRank: number | null; avgRank: number | null; sov: number; obs: number; sponsored: number;
  }>>`
    SELECT k.term AS term,
           MIN(CASE WHEN v."isOwn" THEN v.rank END)::int AS "bestRank",
           AVG(CASE WHEN v."isOwn" THEN v.rank END)::float AS "avgRank",
           (100.0 * SUM(CASE WHEN v."isOwn" THEN 1 ELSE 0 END) / COUNT(*))::float AS sov,
           COUNT(*)::int AS obs,
           SUM(CASE WHEN v."isOwn" AND v."isSponsored" THEN 1 ELSE 0 END)::int AS sponsored
    FROM "VisibilityObservation" v
    JOIN "Keyword" k ON k.id = v."keywordId"
    WHERE ${visWhereSql(f, Prisma.raw("v."))}
    GROUP BY k.term
    ORDER BY sov DESC
    LIMIT ${limit}`;
  return rows.map((r) => ({
    keyword: r.term,
    bestRank: r.bestRank ?? null,
    avgRank: r.avgRank != null ? Math.round(r.avgRank * 10) / 10 : null,
    sovPct: Math.round(r.sov * 10) / 10,
    observations: r.obs,
    sponsoredHits: r.sponsored,
  }));
}

// --- tiny raw-SQL fragment helpers (Prisma.sql) ---
import { Prisma } from "@prisma/client";
function prismaBrand(brandId: bigint) { return Prisma.sql` AND id = ${brandId}`; }
function prismaPlatform(platformId: number) { return Prisma.sql` AND pl."platformId" = ${platformId}`; }
function empty() { return Prisma.empty; }
