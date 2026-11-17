// Product SEO / listing health for the selected brand (Keyword Intelligence page).
import { handler, ok } from "@/lib/http";
import { adsScope } from "@/lib/ads/queries";
import { listingSeo } from "@/lib/seo/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  const scope = await adsScope(req);
  return ok(await listingSeo(scope.orgId, scope.brandId));
});
