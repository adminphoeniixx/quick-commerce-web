// Blinkit Ads account insights: wallet history, festive demand, brand collections.
import { handler, ok } from "@/lib/http";
import { adsScope, adsInsights } from "@/lib/ads/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => ok(await adsInsights(await adsScope(req))));
