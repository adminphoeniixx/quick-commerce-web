// Blinkit Ads: data span, wallet, campaign counts and connection state (page header, date filter).
import { handler, ok } from "@/lib/http";
import { adsScope, adsMeta } from "@/lib/ads/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => ok(await adsMeta(await adsScope(req))));
