import { z } from "zod";
import { adsScope } from "@/lib/ads/queries";
import { assertCsrf, requireSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac/authorize";
import { handler, ok, parseBody } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { decideGrowthPlan } from "@/lib/ads/growth-lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// actionIds: approve only these actions (the rest are rejected). Omitted = approve all.
const schema = z.object({ action: z.enum(["approve", "reject"]), actionIds: z.array(z.string().min(1).max(200)).max(500).optional() });

export const POST = handler(async (req, ctx: { params: { id: string } }) => {
  const session = await requireSession(req); assertCsrf(req);
  const scope = await adsScope(req); await requirePermission(session, scope.orgId, "integration:manage");
  await rateLimit(`ads-growth-decide:${scope.orgId}:${session.userId}`, 30, 3600);
  const body = await parseBody(req, schema);
  return ok(await decideGrowthPlan(scope, { email: session.email, userId: session.userId }, ctx.params.id, body.action, body.actionIds));
});
