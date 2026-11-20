import { adsScope } from "@/lib/ads/queries";
import { requireSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac/authorize";
import { handler, ok } from "@/lib/http";
import { getGrowthPlan } from "@/lib/ads/growth-lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req, ctx: { params: { id: string } }) => {
  const session = await requireSession(req), scope = await adsScope(req);
  await requirePermission(session, scope.orgId, "integration:read");
  return ok({ plan: await getGrowthPlan(scope, ctx.params.id) });
});
