// One Blinkit Ads campaign: settings, KPIs, daily trend, keywords and advertised products.
import { handler, ok, NotFound } from "@/lib/http";
import { adsScope, adsCampaign } from "@/lib/ads/queries";
import { adsRange } from "../../range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req, ctx: { params: { id: string } }) => {
  if (!/^\d{1,20}$/.test(ctx.params.id)) throw NotFound("Campaign not found");
  const scope = await adsScope(req);
  const range = (await adsRange(scope)) ?? { from: new Date(Date.now() - 29 * 86400_000), to: new Date() };
  return ok(await adsCampaign(scope, ctx.params.id, range));
});
