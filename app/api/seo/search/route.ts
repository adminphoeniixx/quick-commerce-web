// SEO view of blinkit.com search results for the brand's Blinkit Ads keywords.
import { handler, ok } from "@/lib/http";
import { adsScope } from "@/lib/ads/queries";
import { searchSeo } from "@/lib/seo/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  const scope = await adsScope(req);
  return ok(await searchSeo(scope.orgId, scope.brandId));
});
