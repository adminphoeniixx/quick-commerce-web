import { adsScope } from "@/lib/ads/queries";
import { assertCsrf, requireSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac/authorize";
import { handler, ok } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { materializeGrowthPlan } from "@/lib/ads/growth-lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req, ctx: { params: { id: string } }) => {
  const session = await requireSession(req); assertCsrf(req);
  const scope = await adsScope(req); await requirePermission(session, scope.orgId, "integration:manage");
  await rateLimit(`ads-growth-materialize:${scope.orgId}:${session.userId}`, 20, 3600);
  return ok(await materializeGrowthPlan(scope, { email: session.email, userId: session.userId }, ctx.params.id));
});
