// Ad coverage per seller product (Blinkit product id → campaigns promoting it, their spend).
import { handler, ok } from "@/lib/http";
import { adsScope, productAdCoverage } from "@/lib/ads/queries";
import { dateRange } from "@/lib/channels/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  const scope = await adsScope(req);
  const range = dateRange(scope.url) ?? { from: new Date(Date.now() - 29 * 86400_000), to: new Date() };
  return ok({ products: await productAdCoverage(scope.orgId, scope.brandId, range) });
});
