import { adsScope } from "@/lib/ads/queries";
import { assertCsrf, requireSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac/authorize";
import { handler, ok } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { enqueueGrowthPlan, listGrowthPlans } from "@/lib/ads/growth-lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  const session = await requireSession(req), scope = await adsScope(req);
  await requirePermission(session, scope.orgId, "integration:read");
  return ok({ plans: await listGrowthPlans(scope) });
});

/** Queues research and returns immediately; the client polls GET /plans/:id. */
export const POST = handler(async (req) => {
  const session = await requireSession(req); assertCsrf(req);
  const scope = await adsScope(req); await requirePermission(session, scope.orgId, "integration:manage");
  await rateLimit(`ads-growth-plan:${scope.orgId}:${session.userId}`, 12, 3600);
  const plan = await enqueueGrowthPlan({ orgId: scope.orgId, brandId: scope.brandId, createdBy: session.email, userId: session.userId, trigger: "manual" });
  return ok({ plan: { id: plan.id.toString(), status: plan.status } }, { status: 202 });
});
