import { prisma } from "@/lib/db";
import type { AdsScope, Range } from "./queries";
import { adsCampaign } from "./queries";
import type { CampaignSuggestion, SalesToolEvidence } from "./campaign-suggestions";

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** Add seller sales, stock, listing quality, search rank, and price evidence before agent review. */
export async function addCampaignResearch(scope: AdsScope, drafts: CampaignSuggestion[], range: Range): Promise<CampaignSuggestion[]> {
  if (!drafts.length) return drafts;
  const details = await Promise.all(drafts.map((draft) => adsCampaign(scope, draft.templateId, range)));
  const productIds = [...new Set(details.flatMap((detail) => detail.products.map((product) => product.productId)))];
  const keywords = [...new Set(details.flatMap((detail) => detail.keywords.map((keyword) => keyword.keyword.toLowerCase())))];
  const [latestSeo, latestSearch, latestInventory] = scope.sellerPlatformId ? await Promise.all([
    prisma.listingSeoSnapshot.findFirst({ where: { brandId: scope.brandId, platformId: scope.sellerPlatformId }, orderBy: { snapshotDate: "desc" }, select: { snapshotDate: true } }),
    prisma.searchListingObservation.findFirst({ where: { brandId: scope.brandId, platformId: scope.sellerPlatformId }, orderBy: { snapshotDate: "desc" }, select: { snapshotDate: true } }),
    prisma.channelInventory.findFirst({ where: { brandId: scope.brandId, platformId: scope.sellerPlatformId }, orderBy: { snapshotDate: "desc" }, select: { snapshotDate: true } }),
  ]) : [null, null, null];
  const [seo, search, inventory] = scope.sellerPlatformId ? await Promise.all([
    latestSeo ? prisma.listingSeoSnapshot.findMany({ where: { brandId: scope.brandId, platformId: scope.sellerPlatformId, snapshotDate: latestSeo.snapshotDate, productId: { in: productIds } }, select: { productId: true, availabilityPct: true, engagementScore: true, issues: true } }) : [],
    latestSearch ? prisma.searchListingObservation.findMany({ where: { brandId: scope.brandId, platformId: scope.sellerPlatformId, snapshotDate: latestSearch.snapshotDate, keyword: { in: keywords } }, select: { keyword: true, productId: true, rank: true, organicRank: true, price: true, soldOut: true, isOwn: true } }) : [],
    latestInventory ? prisma.channelInventory.groupBy({ by: ["itemId"], where: { brandId: scope.brandId, platformId: scope.sellerPlatformId, snapshotDate: latestInventory.snapshotDate }, _sum: { totalSellable: true } }) : [],
  ]) : [[], [], []];
  const seoByProduct = new Map(seo.map((row) => [row.productId, row]));
  const inventoryByItem = new Map(inventory.map((row) => [row.itemId, row._sum.totalSellable ?? 0]));

  return drafts.map((draft, index) => {
    const detail = details[index];
    const ids = new Set(detail.products.map((product) => product.productId));
    const ownSearch = search.filter((row) => row.isOwn && ids.has(row.productId));
    const competitorPrices = search.filter((row) => !row.isOwn && row.price != null).map((row) => row.price!);
    const ownPrices = detail.products.map((product) => product.sellingPrice).filter((value): value is number => value != null);
    const availability = detail.products.map((product) => seoByProduct.get(product.productId)?.availabilityPct).filter((value): value is number => value != null);
    const stock = detail.products.map((product) => product.itemId ? inventoryByItem.get(product.itemId) : null).filter((value): value is number => value != null);
    const issues = detail.products.reduce((sum, product) => {
      const value = seoByProduct.get(product.productId)?.issues;
      return sum + (Array.isArray(value) ? value.length : 0);
    }, 0);
    const salesTools: SalesToolEvidence = {
      sellerGmv: detail.seller.gmv,
      sellerUnits: detail.seller.units,
      tacos: detail.seller.tacos,
      attributedUnits: detail.kpis.qty,
      newUsers: detail.kpis.newUsers,
      atc: detail.kpis.atc,
      directSales: detail.kpis.directSales,
      indirectSales: detail.kpis.indirectSales,
      sellableUnits: stock.length ? stock.reduce((sum, value) => sum + value, 0) : null,
      minimumAvailabilityPct: availability.length ? Math.min(...availability) : null,
      bestSearchRank: ownSearch.length ? Math.min(...ownSearch.map((row) => row.rank)) : null,
      bestOrganicRank: ownSearch.map((row) => row.organicRank).filter((value): value is number => value != null).sort((a, b) => a - b)[0] ?? null,
      ownMedianPrice: median(ownPrices),
      competitorMedianPrice: median(competitorPrices),
      listingIssueCount: issues,
      dataAsOf: { seller: range.to.toISOString().slice(0, 10), inventory: latestInventory?.snapshotDate.toISOString().slice(0, 10) ?? null, listing: latestSeo?.snapshotDate.toISOString().slice(0, 10) ?? null, search: latestSearch?.snapshotDate.toISOString().slice(0, 10) ?? null },
      products: detail.products.map((product) => ({ productId: product.productId, name: product.name, sellerUnits: product.sellerUnits, sellerGmv: product.sellerGmv })),
      topKeywords: detail.keywords.slice(0, 10).map((keyword) => ({ keyword: keyword.keyword, spend: keyword.spend, sales: keyword.sales, roas: keyword.roas })),
    };
    return { ...draft, salesTools };
  });
}
