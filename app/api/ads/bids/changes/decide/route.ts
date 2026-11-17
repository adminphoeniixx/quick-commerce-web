// Approve / reject / cancel PENDING bid changes, or retry FAILED ones. Approving queues the apply
// job: the server's Blinkit Ads session sets the bids (only Owner / Org Admin may decide).
import { z } from "zod";
import { handler, ok, parseBody } from "@/lib/http";
import { assertCsrf, requireSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac/authorize";
import { rateLimit } from "@/lib/ratelimit";
import { adsScope } from "@/lib/ads/queries";
import { decideBids, scheduleBidApply } from "@/lib/ads/bids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  ids: z.array(z.string().regex(/^\d+$/).max(20)).min(1).max(200),
  action: z.enum(["approve", "reject", "retry", "cancel"]),
});

export const POST = handler(async (req) => {
  const session = await requireSession(req);
  assertCsrf(req);
  const scope = await adsScope(req);
  const body = await parseBody(req, schema);
  // Proposers may withdraw their own; approving / rejecting / retrying changes ad spend: Owner / Admin.
  await requirePermission(session, scope.orgId, body.action === "cancel" ? "integration:update" : "integration:manage");
  await rateLimit(`ads-bids-decide:${scope.orgId}`, 60, 3600);
  const res = await decideBids(scope, session.email, session.userId, body.ids.map(BigInt), body.action);
  if (res.apply) await scheduleBidApply(scope.orgId, scope.brandId);
  return ok(res);
});
