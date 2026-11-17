import { z } from "zod";
import { prisma } from "@/lib/db";
import { handler, ok, parseBody, NotFound, Forbidden } from "@/lib/http";
import { requireSession, assertCsrf } from "@/lib/auth/session";
import { requireMembership } from "@/lib/rbac/authorize";
import { requireVerifiedEmail } from "@/lib/auth/verified";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ userId: z.string().min(1) });

// Transfer ownership: caller (OWNER) promotes a member to OWNER and steps down
// to ORG_ADMIN. Atomic, and only an owner may do it.
export const POST = handler(async (req, ctx: { params: { id: string } }) => {
  const session = await requireSession(req);
  assertCsrf(req);
  await requireVerifiedEmail(session);
  let orgId: bigint, targetId: bigint;
  try { orgId = BigInt(ctx.params.id); } catch { throw NotFound("Organization not found"); }

  const me = await requireMembership(session, orgId);
  if (me.role !== "OWNER") throw Forbidden("Only an owner can transfer ownership");

  const { userId } = await parseBody(req, schema);
  try { targetId = BigInt(userId); } catch { throw NotFound("Member not found"); }
  if (targetId === session.userId) throw Forbidden("You already own this organization");

  const target = await prisma.membership.findUnique({ where: { userId_orgId: { userId: targetId, orgId } } });
  if (!target) throw NotFound("Member not found");

  await prisma.$transaction([
    prisma.membership.update({ where: { userId_orgId: { userId: targetId, orgId } }, data: { role: "OWNER" } }),
    prisma.membership.update({ where: { userId_orgId: { userId: session.userId, orgId } }, data: { role: "ORG_ADMIN" } }),
  ]);
  await writeAudit({ userId: session.userId, orgId, action: "org.ownership_transferred", target: targetId.toString() });
  return ok({ newOwnerId: targetId });
});
