import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { AdsScope, Range } from "@/lib/ads/queries";
import type { BidRecommendationInput, BidResearch } from "./bid-recommendations";

const norm = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
const key = (campaignId: string, keyword: string, matchType: string) => `${campaignId}|${norm(keyword)}|${matchType.toUpperCase().replace(/_MATCH$/, "")}`;
const median = (values: number[]) => { if (!values.length) return null; const rows = [...values].sort((a, b) => a - b); return rows[Math.floor(rows.length / 2)]; };

export async function addBidResearch(scope: AdsScope, rows: BidRecommendationInput[], range: Range): Promise<BidRecommendationInput[]> {
  if (!rows.length) return rows;
  const campaignIds = [...new Set(rows.map((row) => row.campaignId))];
  const keywords = [...new Set(rows.map((row) => norm(row.keyword)))];
  const campaigns = await prisma.adCampaign.findMany({ where: { brandId: scope.brandId, platformId: scope.platformId, campaignId: { in: campaignIds } }, select: { campaignId: true, productIds: true } });
  const productIds = [...new Set(campaigns.flatMap((campaign) => campaign.productIds))];
  const productsByCampaign = new Map(campaigns.map((campaign) => [campaign.campaignId, campaign.productIds]));
  const from7 = new Date(range.to); from7.setUTCDate(from7.getUTCDate() - 6);

  const [trend7, latestSeo, latestSearch, previous] = await Promise.all([
    prisma.$queryRaw<{ campaignId: string; keyword: string; matchType: string | null; spend: unknown; sales: unknown }[]>`
      SELECT "campaignId", lower(label) keyword, "matchType", SUM(spend) spend, SUM("directSales" + "indirectSales") sales
      FROM "AdKeywordDaily" WHERE "brandId"=${scope.brandId} AND "platformId"=${scope.platformId}
      AND "campaignId" IN (${Prisma.join(campaignIds)}) AND date BETWEEN ${from7} AND ${range.to} AND dimension='keyword' GROUP BY 1,2,3`,
    scope.sellerPlatformId ? prisma.listingSeoSnapshot.findFirst({ where: { brandId: scope.brandId, platformId: scope.sellerPlatformId }, orderBy: { snapshotDate: "desc" }, select: { snapshotDate: true } }) : null,
    scope.sellerPlatformId ? prisma.searchListingObservation.findFirst({ where: { brandId: scope.brandId, platformId: scope.sellerPlatformId }, orderBy: { snapshotDate: "desc" }, select: { snapshotDate: true } }) : null,
    prisma.adBidChange.findMany({ where: { brandId: scope.brandId, platformId: scope.platformId, campaignId: { in: campaignIds }, status: "APPLIED" }, orderBy: { appliedAt: "desc" }, take: 500 }),
  ]);
  const [seo, search, sellerProducts, inventoryDate] = await Promise.all([
    latestSeo && scope.sellerPlatformId ? prisma.listingSeoSnapshot.findMany({ where: { brandId: scope.brandId, platformId: scope.sellerPlatformId, snapshotDate: latestSeo.snapshotDate, productId: { in: productIds } }, select: { productId: true, availabilityPct: true } }) : [],
    latestSearch && scope.sellerPlatformId ? prisma.searchListingObservation.findMany({ where: { brandId: scope.brandId, platformId: scope.sellerPlatformId, snapshotDate: latestSearch.snapshotDate, keyword: { in: keywords } }, select: { keyword: true, rank: true, organicRank: true, productId: true, price: true, isOwn: true } }) : [],
    scope.sellerPlatformId ? prisma.channelProduct.findMany({ where: { brandId: scope.brandId, platformId: scope.sellerPlatformId, productId: { in: productIds } }, select: { productId: true, itemId: true, sellingPrice: true } }) : [],
    scope.sellerPlatformId ? prisma.channelInventory.findFirst({ where: { brandId: scope.brandId, platformId: scope.sellerPlatformId }, orderBy: { snapshotDate: "desc" }, select: { snapshotDate: true } }) : null,
  ]);
  const inventory = inventoryDate && scope.sellerPlatformId ? await prisma.channelInventory.groupBy({ by: ["itemId"], where: { brandId: scope.brandId, platformId: scope.sellerPlatformId, snapshotDate: inventoryDate.snapshotDate, itemId: { in: sellerProducts.map((product) => product.itemId) } }, _sum: { totalSellable: true } }) : [];
  const itemStock = new Map(inventory.map((row) => [row.itemId, row._sum.totalSellable ?? 0]));
  const productData = new Map(sellerProducts.filter((p) => p.productId).map((p) => [p.productId!, { price: p.sellingPrice == null ? null : Number(p.sellingPrice), stock: itemStock.get(p.itemId) ?? null }]));
  const avail = new Map(seo.map((row) => [row.productId, row.availabilityPct]));
  const trend = new Map(trend7.map((row) => [key(row.campaignId, row.keyword, row.matchType ?? ""), Number(row.spend) ? Number(row.sales) / Number(row.spend) : null]));
  const prior = new Map<string, string>();
  for (const change of previous) { const k = key(change.campaignId, change.keyword, change.matchType); if (!prior.has(k)) prior.set(k, `Previous applied bid ₹${change.beforeCpm ?? change.fromCpm ?? "?"} → ₹${change.afterCpm ?? change.toCpm}`); }

  return rows.map((row) => {
    const ids = productsByCampaign.get(row.campaignId) ?? [];
    const ownSearch = search.filter((entry) => entry.isOwn && norm(entry.keyword) === norm(row.keyword) && ids.includes(entry.productId));
    const competitors = search.filter((entry) => !entry.isOwn && norm(entry.keyword) === norm(row.keyword) && entry.price != null).map((entry) => entry.price!);
    const availability = ids.map((id) => avail.get(id)).filter((value): value is number => value != null);
    const stock = ids.map((id) => productData.get(id)?.stock).filter((value): value is number => value != null);
    const prices = ids.map((id) => productData.get(id)?.price).filter((value): value is number => value != null);
    const warnings = ["Product COGS is unavailable; profit break-even cannot be calculated."];
    if (!ownSearch.length) warnings.push("Fresh Blinkit search ranking is unavailable for this keyword and campaign product.");
    if (!availability.length) warnings.push("Fresh seller availability is unavailable.");
    const research: BidResearch = {
      roas7d: trend.get(key(row.campaignId, row.keyword, row.matchType)) ?? null,
      ownSearchRank: ownSearch.length ? Math.min(...ownSearch.map((entry) => entry.rank)) : null,
      organicRank: ownSearch.map((entry) => entry.organicRank).filter((value): value is number => value != null).sort((a, b) => a - b)[0] ?? null,
      availabilityPct: availability.length ? Math.min(...availability) : null,
      sellableUnits: stock.length ? stock.reduce((sum, value) => sum + value, 0) : null,
      ownPrice: prices.length ? median(prices) : null,
      competitorMedianPrice: median(competitors),
      previousBid: prior.get(key(row.campaignId, row.keyword, row.matchType)) ?? null,
      dataWarnings: warnings,
    };
    return { ...row, research };
  });
}
