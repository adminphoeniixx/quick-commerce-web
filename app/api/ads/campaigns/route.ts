// Blinkit Ads campaigns for the selected brand and period.
import { handler, ok } from "@/lib/http";
import { adsScope, adsCampaigns } from "@/lib/ads/queries";
import { adsRange } from "../range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  const scope = await adsScope(req);
  const range = await adsRange(scope);
  if (!range) return ok({ empty: true });
  const data = await adsCampaigns(scope, range);
  return ok(Array.isArray(data) ? { range: { from: range.from.toISOString().slice(0, 10), to: range.to.toISOString().slice(0, 10) }, rows: data } : data);
});
