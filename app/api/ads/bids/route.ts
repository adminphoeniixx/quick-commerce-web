// Every Blinkit Ads keyword bid (campaign × keyword × match type) with performance and open changes.
// ?productId= one product's bids · ?campaignId= one campaign · ?active=1 only ACTIVE campaigns.
import { handler, ok } from "@/lib/http";
import { adsScope } from "@/lib/ads/queries";
import { listBids } from "@/lib/ads/bids";
import { adsRange } from "../range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  const scope = await adsScope(req);
  const q = scope.url.searchParams;
  const range = await adsRange(scope);
  const productId = q.get("productId")?.trim() || undefined, campaignId = q.get("campaignId")?.trim() || undefined;
  return ok(await listBids(scope, range, { productId, campaignId, activeOnly: q.get("active") === "1" }));
});
