import { prisma } from "@/lib/db";
import { adsMeta, adsScope } from "@/lib/ads/queries";
import { requireSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac/authorize";
import { handler, ok } from "@/lib/http";
import { buildKeywordBoard } from "@/lib/ads/keyword-growth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only Keyword growth board: every keyword's rank, ROAS, budget use, stock and decision. No AI calls. */
export const GET = handler(async (req) => {
  const session = await requireSession(req), scope = await adsScope(req);
  await requirePermission(session, scope.orgId, "integration:read");
  const [meta, goal] = await Promise.all([adsMeta(scope), prisma.salesGrowthGoal.findFirst({ where: { orgId: scope.orgId, brandId: scope.brandId, active: true }, orderBy: { createdAt: "desc" } })]);
  if (!meta.to) return ok({ decisions: [], campaignChanges: [], goal: null });
  const g = { minimumRoas: Number(goal?.minimumRoas ?? 2), maxDailyAdSpend: Number(goal?.maxDailyAdSpend ?? 0), horizonDays: goal?.horizonDays ?? 30 };
  const board = await buildKeywordBoard(scope, g, new Date(`${meta.to}T00:00:00Z`));
  return ok({ decisions: board.decisions, campaignChanges: board.campaignChanges, goal: goal ? g : null });
});
