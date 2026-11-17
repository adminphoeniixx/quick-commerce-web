// Read models for the Blinkit Ads pages and the ad widgets on seller / dashboard pages.
// ROAS = attributed sales / spend, CPM = spend per 1,000 impressions, TACoS = ad spend /
// total Blinkit seller sales (delivered order lines) for the same brand and period.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { BadRequest, NotFound } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { requirePermission, resolveOrgId } from "@/lib/rbac/authorize";
import { NOT_SOLD_STATUS } from "@/lib/channels/ingest";

export const ADS_PLATFORM = "blinkit-ads";
export interface AdsScope { orgId: bigint; brandId: bigint; platformId: number; sellerPlatformId: number | null; url: URL }
export interface Range { from: Date; to: Date }

const n = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const ratio = (a: number, b: number) => (b ? a / b : null);

async function platformIds() {
  const rows = await prisma.platform.findMany({ where: { slug: { in: [ADS_PLATFORM, "blinkit"] } }, select: { id: true, slug: true } });
  const ads = rows.find((r) => r.slug === ADS_PLATFORM)?.id;
  if (!ads) throw BadRequest("Blinkit Ads platform is not set up (run migrations)");
  return { ads, seller: rows.find((r) => r.slug === "blinkit")?.id ?? null };
}

/** Session + permission + brand-in-org resolution shared by the ads APIs. */
export async function adsScope(req: Request): Promise<AdsScope> {
  const session = await requireSession(req);
  const url = new URL(req.url);
  const orgId = resolveOrgId(session);
  await requirePermission(session, orgId, "sales:read");
  const brandRaw = url.searchParams.get("brandId");
  const brand = brandRaw && /^\d+$/.test(brandRaw)
    ? await prisma.brand.findFirst({ where: { id: BigInt(brandRaw), orgId }, select: { id: true } })
    : await prisma.brand.findFirst({ where: { orgId }, orderBy: { id: "asc" }, select: { id: true } });
  if (!brand) throw BadRequest("Brand not found");
  const ids = await platformIds();
  return { orgId, brandId: brand.id, platformId: ids.ads, sellerPlatformId: ids.seller, url };
}

const where = (s: AdsScope, r: Range) => Prisma.sql`"brandId" = ${s.brandId} AND "platformId" = ${s.platformId} AND date BETWEEN ${r.from} AND ${r.to}`;

export async function adsMeta(s: AdsScope) {
  const [[span], account, counts, connection] = await Promise.all([
    prisma.$queryRaw<{ min: Date | null; max: Date | null; days: unknown }[]>`
      SELECT MIN(date) AS min, MAX(date) AS max, COUNT(DISTINCT date) AS days FROM "AdCampaignDaily"
      WHERE "brandId" = ${s.brandId} AND "platformId" = ${s.platformId}`,
    prisma.adAccountSnapshot.findFirst({
      where: { brandId: s.brandId, platformId: s.platformId }, orderBy: { snapshotDate: "desc" },
      select: { snapshotDate: true, advertiserName: true, walletBalance: true, tentativeSpend: true, creditBalance: true, updatedAt: true },
    }),
    prisma.adCampaign.groupBy({ by: ["status"], where: { brandId: s.brandId, platformId: s.platformId }, _count: true }),
    prisma.platformConnection.findUnique({
      where: { brandId_platformId: { brandId: s.brandId, platformId: s.platformId } },
      select: { id: true, status: true, lastVerifiedAt: true, lastError: true },
    }),
  ]);
  return {
    from: span?.min ? iso(span.min) : null, to: span?.max ? iso(span.max) : null, days: n(span?.days),
    account: account && {
      advertiserName: account.advertiserName, snapshotDate: iso(account.snapshotDate), updatedAt: account.updatedAt,
      walletBalance: account.walletBalance == null ? null : n(account.walletBalance),
      tentativeSpend: account.tentativeSpend == null ? null : n(account.tentativeSpend),
      creditBalance: account.creditBalance == null ? null : n(account.creditBalance),
    },
    campaigns: { total: counts.reduce((a, c) => a + c._count, 0), active: counts.find((c) => c.status === "ACTIVE")?._count ?? 0 },
    connection,
  };
}

interface MetricRow { spend: unknown; impressions: unknown; ctrw: unknown; atc: unknown; datc: unknown; iatc: unknown; sales: unknown; dsales: unknown; isales: unknown; qty: unknown; users: unknown }
const METRICS = Prisma.sql`SUM(spend) AS spend, SUM(impressions) AS impressions, SUM(COALESCE(ctr, 0) * impressions) AS ctrw,
  SUM("totalAtc") AS atc, SUM("directAtc") AS datc, SUM("indirectAtc") AS iatc, SUM("totalSales") AS sales,
  SUM("directSales") AS dsales, SUM("indirectSales") AS isales, SUM("totalQty") AS qty, SUM("newUsers") AS users`;

export function metrics(r: Partial<MetricRow> | undefined) {
  const spend = n(r?.spend), impressions = n(r?.impressions), sales = n(r?.sales), atc = n(r?.atc);
  return {
    spend, impressions, sales, atc, directAtc: n(r?.datc), indirectAtc: n(r?.iatc), directSales: n(r?.dsales), indirectSales: n(r?.isales),
    qty: n(r?.qty), newUsers: n(r?.users),
    roas: ratio(sales, spend), directRoas: ratio(n(r?.dsales), spend), cpm: impressions ? (spend / impressions) * 1000 : null,
    // Blinkit reports CTR as 0 for most placements: no value rather than a misleading 0%.
    ctr: impressions && n(r?.ctrw) > 0 ? n(r?.ctrw) / impressions : null, costPerAtc: ratio(spend, atc), atcRate: impressions ? atc / impressions : null,
    acos: ratio(spend, sales),
  };
}

async function sellerGmv(s: AdsScope, r: Range, productIds?: string[]) {
  if (!s.sellerPlatformId) return { gmv: 0, units: 0 };
  const products = productIds?.length
    ? Prisma.sql`AND "itemId" IN (SELECT "itemId" FROM "ChannelProduct" WHERE "brandId" = ${s.brandId} AND "platformId" = ${s.sellerPlatformId} AND "productId" IN (${Prisma.join(productIds)}))`
    : Prisma.empty;
  const [row] = await prisma.$queryRaw<{ gmv: unknown; units: unknown }[]>`
    SELECT SUM("grossAmount") AS gmv, SUM(quantity) AS units FROM "ChannelOrder"
    WHERE "brandId" = ${s.brandId} AND "platformId" = ${s.sellerPlatformId} AND "orderDate" BETWEEN ${r.from} AND ${r.to}
      AND status !~* ${NOT_SOLD_STATUS} ${products}`;
  return { gmv: n(row?.gmv), units: n(row?.units) };
}

export async function adsOverview(s: AdsScope, r: Range) {
  const [[k], trend, byType, campaigns, keywords, seller, sellerTrend] = await Promise.all([
    prisma.$queryRaw<MetricRow[]>`SELECT ${METRICS} FROM "AdCampaignDaily" WHERE ${where(s, r)}`,
    prisma.$queryRaw<(MetricRow & { day: Date })[]>`SELECT date AS day, ${METRICS} FROM "AdCampaignDaily" WHERE ${where(s, r)} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<(MetricRow & { type: string; campaigns: unknown })[]>`
      SELECT c."campaignType" AS type, COUNT(DISTINCT d."campaignId") AS campaigns, ${METRICS}
      FROM "AdCampaignDaily" d JOIN "AdCampaign" c ON c."brandId" = d."brandId" AND c."platformId" = d."platformId" AND c."campaignId" = d."campaignId"
      WHERE d."brandId" = ${s.brandId} AND d."platformId" = ${s.platformId} AND d.date BETWEEN ${r.from} AND ${r.to}
      GROUP BY 1 ORDER BY spend DESC`,
    adsCampaigns(s, r),
    adsKeywords(s, r, 10),
    sellerGmv(s, r),
    s.sellerPlatformId ? prisma.$queryRaw<{ day: Date; gmv: unknown }[]>`
      SELECT "orderDate" AS day, SUM("grossAmount") AS gmv FROM "ChannelOrder"
      WHERE "brandId" = ${s.brandId} AND "platformId" = ${s.sellerPlatformId} AND "orderDate" BETWEEN ${r.from} AND ${r.to} AND status !~* ${NOT_SOLD_STATUS}
      GROUP BY 1` : Promise.resolve([]),
  ]);
  const kpis = metrics(k);
  const gmvByDay = new Map(sellerTrend.map((t) => [iso(t.day), n(t.gmv)]));
  return {
    range: { from: iso(r.from), to: iso(r.to) },
    kpis,
    seller: { gmv: seller.gmv, tacos: ratio(kpis.spend, seller.gmv), adSalesShare: ratio(kpis.sales, seller.gmv) },
    trend: trend.map((t) => ({ date: iso(t.day), ...metrics(t), sellerGmv: gmvByDay.get(iso(t.day)) ?? 0 })),
    byType: byType.map((t) => ({ type: t.type, campaigns: n(t.campaigns), ...metrics(t) })),
    topCampaigns: campaigns.filter((c) => c.period.spend > 0).slice(0, 10),
    topKeywords: keywords,
  };
}

export async function adsCampaigns(s: AdsScope, r: Range) {
  const [list, period] = await Promise.all([
    prisma.adCampaign.findMany({ where: { brandId: s.brandId, platformId: s.platformId } }),
    prisma.$queryRaw<(MetricRow & { id: string })[]>`SELECT "campaignId" AS id, ${METRICS} FROM "AdCampaignDaily" WHERE ${where(s, r)} GROUP BY 1`,
  ]);
  const byId = new Map(period.map((p) => [p.id, metrics(p)]));
  const empty = metrics(undefined);
  return list.map((c) => ({
    campaignId: c.campaignId, name: c.name, type: c.campaignType, objective: c.objective, status: c.status,
    startAt: c.startAt, endAt: c.endAt, budget: c.budget == null ? null : n(c.budget), pacing: c.pacing,
    regionType: c.regionType, cities: c.cities, productIds: c.productIds,
    lifetime: { spend: c.lifetimeSpend == null ? null : n(c.lifetimeSpend), impressions: c.lifetimeImpressions == null ? null : n(c.lifetimeImpressions), sales: c.lifetimeSales == null ? null : n(c.lifetimeSales), atc: c.lifetimeAtc },
    period: byId.get(c.campaignId) ?? empty,
  })).sort((a, b) => b.period.spend - a.period.spend || (a.status === "ACTIVE" ? -1 : 1) - (b.status === "ACTIVE" ? -1 : 1));
}

const KW_METRICS = Prisma.sql`SUM(impressions) AS impressions, SUM(spend) AS spend, SUM("directAtc" + "indirectAtc") AS atc,
  SUM("directSales" + "indirectSales") AS sales, SUM("directSales") AS dsales, SUM("directQty" + "indirectQty") AS qty, SUM("newUsers") AS users,
  SUM(COALESCE(position, 0) * impressions) / NULLIF(SUM(CASE WHEN position IS NULL THEN 0 ELSE impressions END), 0) AS position`;
interface KwRow { label: string; match: string | null; impressions: unknown; spend: unknown; atc: unknown; sales: unknown; dsales: unknown; qty: unknown; users: unknown; position: unknown }
const kw = (r: KwRow) => {
  const spend = n(r.spend), impressions = n(r.impressions), sales = n(r.sales);
  return { keyword: r.label, matchType: r.match, impressions, spend, atc: n(r.atc), sales, directSales: n(r.dsales), qty: n(r.qty), newUsers: n(r.users),
    roas: ratio(sales, spend), cpm: impressions ? (spend / impressions) * 1000 : null, position: r.position == null ? null : Math.round(n(r.position) * 10) / 10 };
};

export async function adsKeywords(s: AdsScope, r: Range, limit = 500, campaignId?: string) {
  const forCampaign = campaignId ? Prisma.sql`AND k."campaignId" = ${campaignId}` : Prisma.empty;
  const rows = await prisma.$queryRaw<(KwRow & { campaigns: string[] })[]>`
    SELECT k.label, k."matchType" AS match, ${KW_METRICS}, ARRAY_AGG(DISTINCT c.name) AS campaigns
    FROM "AdKeywordDaily" k LEFT JOIN "AdCampaign" c ON c."brandId" = k."brandId" AND c."platformId" = k."platformId" AND c."campaignId" = k."campaignId"
    WHERE k."brandId" = ${s.brandId} AND k."platformId" = ${s.platformId} AND k.date BETWEEN ${r.from} AND ${r.to} ${forCampaign}
    GROUP BY 1, 2 ORDER BY spend DESC LIMIT ${limit}`;
  return rows.map((x) => ({ ...kw(x), campaigns: (x.campaigns ?? []).filter(Boolean) }));
}

export async function keywordSpan(s: AdsScope) {
  const [row] = await prisma.$queryRaw<{ min: Date | null; max: Date | null }[]>`
    SELECT MIN(date) AS min, MAX(date) AS max FROM "AdKeywordDaily" WHERE "brandId" = ${s.brandId} AND "platformId" = ${s.platformId}`;
  return { from: row?.min ? iso(row.min) : null, to: row?.max ? iso(row.max) : null };
}

export async function adsCampaign(s: AdsScope, campaignId: string, r: Range) {
  const c = await prisma.adCampaign.findUnique({ where: { brandId_platformId_campaignId: { brandId: s.brandId, platformId: s.platformId, campaignId } } });
  if (!c) throw NotFound("Campaign not found");
  const cw = Prisma.sql`${where(s, r)} AND "campaignId" = ${campaignId}`;
  const [[k], trend, keywords, products, seller] = await Promise.all([
    prisma.$queryRaw<MetricRow[]>`SELECT ${METRICS} FROM "AdCampaignDaily" WHERE ${cw}`,
    prisma.$queryRaw<(MetricRow & { day: Date })[]>`SELECT date AS day, ${METRICS} FROM "AdCampaignDaily" WHERE ${cw} GROUP BY 1 ORDER BY 1`,
    adsKeywords(s, r, 500, campaignId),
    s.sellerPlatformId && c.productIds.length ? prisma.$queryRaw<{ productId: string; itemId: string; name: string; mrp: unknown; sp: unknown; units: unknown; gmv: unknown }[]>`
      SELECT p."productId", p."itemId", p.name, p.mrp, p."sellingPrice" AS sp,
             COALESCE(SUM(o.quantity), 0) AS units, COALESCE(SUM(o."grossAmount"), 0) AS gmv
      FROM "ChannelProduct" p
      LEFT JOIN "ChannelOrder" o ON o."brandId" = p."brandId" AND o."platformId" = p."platformId" AND o."itemId" = p."itemId"
        AND o."orderDate" BETWEEN ${r.from} AND ${r.to} AND o.status !~* ${NOT_SOLD_STATUS}
      WHERE p."brandId" = ${s.brandId} AND p."platformId" = ${s.sellerPlatformId} AND p."productId" IN (${Prisma.join(c.productIds)})
      GROUP BY 1, 2, 3, 4, 5` : Promise.resolve([]),
    sellerGmv(s, r, c.productIds),
  ]);
  const kpis = metrics(k);
  const known = new Set(products.map((p) => p.productId));
  return {
    range: { from: iso(r.from), to: iso(r.to) },
    campaign: {
      campaignId: c.campaignId, name: c.name, type: c.campaignType, objective: c.objective, status: c.status, startAt: c.startAt, endAt: c.endAt,
      budget: c.budget == null ? null : n(c.budget), pacing: c.pacing, regionType: c.regionType, cities: c.cities,
      targetedKeywords: ((c.keywords ?? []) as { keyword: string; bids?: { match_type?: string; cpm?: number }[] }[]).map((x) => ({ keyword: x.keyword, bids: x.bids ?? [] })),
      lifetime: { spend: c.lifetimeSpend == null ? null : n(c.lifetimeSpend), impressions: c.lifetimeImpressions == null ? null : n(c.lifetimeImpressions), sales: c.lifetimeSales == null ? null : n(c.lifetimeSales), atc: c.lifetimeAtc },
      updatedAt: c.updatedAt,
    },
    kpis,
    trend: trend.map((t) => ({ date: iso(t.day), ...metrics(t) })),
    keywords,
    products: [
      ...products.map((p) => ({ productId: p.productId, itemId: p.itemId, name: p.name, mrp: p.mrp == null ? null : n(p.mrp), sellingPrice: p.sp == null ? null : n(p.sp), sellerUnits: n(p.units), sellerGmv: n(p.gmv) })),
      ...c.productIds.filter((id) => !known.has(id)).map((id) => ({ productId: id, itemId: null, name: null, mrp: null, sellingPrice: null, sellerUnits: 0, sellerGmv: 0 })),
    ],
    seller: { gmv: seller.gmv, units: seller.units, tacos: ratio(kpis.spend, seller.gmv) },
  };
}

export async function adsInsights(s: AdsScope) {
  const [latest, wallet] = await Promise.all([
    prisma.adAccountSnapshot.findFirst({ where: { brandId: s.brandId, platformId: s.platformId }, orderBy: { snapshotDate: "desc" } }),
    prisma.adAccountSnapshot.findMany({
      where: { brandId: s.brandId, platformId: s.platformId }, orderBy: { snapshotDate: "asc" }, take: 120,
      select: { snapshotDate: true, walletBalance: true, creditBalance: true },
    }),
  ]);
  if (!latest) return { empty: true as const };
  const details = (latest.details ?? {}) as { features?: Record<string, boolean>; plans?: unknown[]; compliance?: string };
  return {
    advertiserName: latest.advertiserName, advertiserId: latest.advertiserId, status: latest.status, compliance: details.compliance ?? null,
    snapshotDate: iso(latest.snapshotDate), updatedAt: latest.updatedAt,
    walletBalance: latest.walletBalance == null ? null : n(latest.walletBalance), tentativeSpend: latest.tentativeSpend == null ? null : n(latest.tentativeSpend),
    creditBalance: latest.creditBalance == null ? null : n(latest.creditBalance),
    festive: latest.festive, collections: latest.collections, plans: details.plans ?? [],
    walletHistory: wallet.map((w) => ({ date: iso(w.snapshotDate), wallet: w.walletBalance == null ? null : n(w.walletBalance), credit: w.creditBalance == null ? null : n(w.creditBalance) })),
  };
}

/** Ad totals for the main dashboard widget: one brand, or every brand in the org. */
export async function adsSummary(orgId: bigint, brandId: bigint | null, r: Range) {
  const ids = await platformIds();
  const brand = brandId ? Prisma.sql`AND "brandId" = ${brandId}` : Prisma.empty;
  const [[k], trend, [seller], [acct], connected] = await Promise.all([
    prisma.$queryRaw<MetricRow[]>`SELECT ${METRICS} FROM "AdCampaignDaily" WHERE "orgId" = ${orgId} AND "platformId" = ${ids.ads} ${brand} AND date BETWEEN ${r.from} AND ${r.to}`,
    prisma.$queryRaw<{ day: Date; spend: unknown; sales: unknown }[]>`
      SELECT date AS day, SUM(spend) AS spend, SUM("totalSales") AS sales FROM "AdCampaignDaily"
      WHERE "orgId" = ${orgId} AND "platformId" = ${ids.ads} ${brand} AND date BETWEEN ${r.from} AND ${r.to} GROUP BY 1 ORDER BY 1`,
    ids.seller ? prisma.$queryRaw<{ gmv: unknown }[]>`
      SELECT SUM("grossAmount") AS gmv FROM "ChannelOrder" WHERE "orgId" = ${orgId} AND "platformId" = ${ids.seller} ${brand}
        AND "orderDate" BETWEEN ${r.from} AND ${r.to} AND status !~* ${NOT_SOLD_STATUS}` : Promise.resolve([{ gmv: 0 }]),
    prisma.$queryRaw<{ wallet: unknown; active: unknown }[]>`
      SELECT (SELECT SUM(w) FROM (SELECT DISTINCT ON ("brandId") "walletBalance" AS w FROM "AdAccountSnapshot"
               WHERE "orgId" = ${orgId} AND "platformId" = ${ids.ads} ${brand} ORDER BY "brandId", "snapshotDate" DESC) x) AS wallet,
             (SELECT COUNT(*) FROM "AdCampaign" WHERE "orgId" = ${orgId} AND "platformId" = ${ids.ads} ${brand} AND status = 'ACTIVE') AS active`,
    prisma.platformConnection.count({ where: { orgId, platformId: ids.ads, ...(brandId ? { brandId } : {}) } }),
  ]);
  const kpis = metrics(k);
  const gmv = n(seller?.gmv);
  return {
    connected: connected > 0, hasData: kpis.impressions > 0 || kpis.spend > 0,
    ...kpis, sellerGmv: gmv, tacos: ratio(kpis.spend, gmv), adSalesShare: ratio(kpis.sales, gmv),
    walletBalance: acct?.wallet == null ? null : n(acct.wallet), activeCampaigns: n(acct?.active),
    trend: trend.map((t) => ({ date: iso(t.day), spend: n(t.spend), sales: n(t.sales) })),
  };
}

/** Which ad campaigns promote each seller product (by Blinkit product id), with their period spend. */
export async function productAdCoverage(orgId: bigint, brandId: bigint, r: Range) {
  const ids = await platformIds();
  const rows = await prisma.$queryRaw<{ productId: string; campaigns: unknown; active: unknown; spend: unknown; sales: unknown; names: string[] }[]>`
    SELECT pid AS "productId", COUNT(DISTINCT c."campaignId") AS campaigns, COUNT(DISTINCT c."campaignId") FILTER (WHERE c.status = 'ACTIVE') AS active,
           COALESCE(SUM(d.spend), 0) AS spend, COALESCE(SUM(d."totalSales"), 0) AS sales, ARRAY_AGG(DISTINCT c.name) AS names
    FROM "AdCampaign" c CROSS JOIN LATERAL UNNEST(c."productIds") AS pid
    LEFT JOIN (SELECT "campaignId", SUM(spend) AS spend, SUM("totalSales") AS "totalSales" FROM "AdCampaignDaily"
               WHERE "orgId" = ${orgId} AND "brandId" = ${brandId} AND "platformId" = ${ids.ads} AND date BETWEEN ${r.from} AND ${r.to} GROUP BY 1) d
      ON d."campaignId" = c."campaignId"
    WHERE c."orgId" = ${orgId} AND c."brandId" = ${brandId} AND c."platformId" = ${ids.ads}
    GROUP BY 1`;
  return Object.fromEntries(rows.map((x) => [x.productId, {
    campaigns: n(x.campaigns), active: n(x.active), campaignSpend: n(x.spend), campaignSales: n(x.sales), names: x.names ?? [],
  }]));
}
