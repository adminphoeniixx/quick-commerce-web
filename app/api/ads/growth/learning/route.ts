import { adsScope } from "@/lib/ads/queries";
import { requireSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac/authorize";
import { handler, ok } from "@/lib/http";
import { learningSummary } from "@/lib/ads/growth-learning";
import { topMarketInsights } from "@/lib/ads/market-learning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only view of what the growth agents have learned for this brand. */
export const GET = handler(async (req) => {
  const session = await requireSession(req), scope = await adsScope(req);
  await requirePermission(session, scope.orgId, "integration:read");
  const [summary, market] = await Promise.all([learningSummary(scope.brandId), topMarketInsights(scope.brandId)]);
  return ok({ ...summary, market: market.map((m) => ({ keyword: m.keyword, sampleDays: m.sampleDays, confidence: m.confidence, meanDailySales: m.meanDailySales, avgOrganicRank: m.avgOrganicRank, rankSensitivityPct: m.rankSensitivityPct, avgPriceGapPct: m.avgPriceGapPct, priceSensitivityPct: m.priceSensitivityPct, stockoutUpliftPct: m.stockoutUpliftPct, adShareTop10: m.adShareTop10, updatedAt: m.updatedAt })) });
});
