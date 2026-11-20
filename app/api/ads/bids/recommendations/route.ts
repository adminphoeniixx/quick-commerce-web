import { handler, ok } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/ratelimit";
import { adsMeta, adsScope } from "@/lib/ads/queries";
import { listBids } from "@/lib/ads/bids";
import { recommendBids } from "@/lib/ads/bid-recommendations";
import { analyzeBidRecommendations } from "@/lib/ads/bid-analysis-agents";
import { addBidResearch } from "@/lib/ads/bid-research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const cache = new Map<string, { expires: number; value: Promise<unknown> }>();

export const GET = handler(async (req) => {
  await requireSession(req);
  const scope = await adsScope(req);
  const meta = await adsMeta(scope);
  if (!meta.from || !meta.to) return ok({ recommendations: [], mode: "not-needed", reason: "Sync Blinkit Ads performance first." });
  const to = new Date(`${meta.to}T00:00:00Z`), earliest = new Date(`${meta.from}T00:00:00Z`);
  const range = { from: new Date(Math.max(earliest.getTime(), to.getTime() - 29 * 86400_000)), to };
  const key = `${scope.brandId}:${range.from.toISOString()}:${range.to.toISOString()}`;
  let hit = cache.get(key);
  if (!hit || hit.expires <= Date.now()) {
    await rateLimit(`ads-bid-recommendations:${scope.orgId}`, 12, 3600);
    const value = (async () => {
      const data = await listBids(scope, range, { activeOnly: true });
      const rows = data.campaigns.flatMap((campaign) => campaign.keywords.flatMap((keyword) => keyword.bids.map((bid) => ({ campaignId: campaign.campaignId, campaignName: campaign.name, campaignStatus: campaign.status, keyword: keyword.keyword, matchType: bid.matchType, cpm: bid.cpm, hasOpenChange: !!bid.open, impressions: bid.perf?.impressions ?? 0, spend: bid.perf?.spend ?? 0, sales: bid.perf?.sales ?? 0, atc: bid.perf?.atc ?? 0, position: bid.perf?.position ?? null, roas: bid.perf?.roas ?? null }))));
      const researched = await addBidResearch(scope, rows, range);
      const drafts = recommendBids(researched, data.limits);
      return { ...(await analyzeBidRecommendations(drafts)), range: data.range, generatedAt: new Date().toISOString() };
    })();
    hit = { expires: Date.now() + 10 * 60_000, value }; cache.set(key, hit); value.catch(() => cache.delete(key));
  }
  return ok(await hit.value);
});
