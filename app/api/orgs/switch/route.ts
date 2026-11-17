import { handler, ok, parseBody } from "@/lib/http";
import { requireSession, assertCsrf } from "@/lib/auth/session";
import { requireMembership } from "@/lib/rbac/authorize";
import { switchOrgSchema } from "@/lib/validation";
import { setActiveOrg } from "@/lib/auth/cookies";
import { NotFound } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  const session = await requireSession(req);
  assertCsrf(req);
  const { orgId } = await parseBody(req, switchOrgSchema);
  let id: bigint;
  try { id = BigInt(orgId); } catch { throw NotFound("Organization not found"); }
  const membership = await requireMembership(session, id); // must belong
  const res = ok({ activeOrgId: id, role: membership.role });
  setActiveOrg(res, id.toString());
  return res;
});
