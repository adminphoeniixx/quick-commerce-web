import { prisma } from "@/lib/db";
import { handler, ok, parseBody, NotFound, Forbidden, BadRequest } from "@/lib/http";
import { requireSession, assertCsrf } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac/authorize";
import { updateRoleSchema } from "@/lib/validation";
import { writeAudit } from "@/lib/audit";
import type { MembershipRole } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ids(ctx: { params: { id: string; userId: string } }): { orgId: bigint; userId: bigint } {
  try { return { orgId: BigInt(ctx.params.id), userId: BigInt(ctx.params.userId) }; }
  catch { throw NotFound("Not found"); }
}

async function ownerCount(orgId: bigint): Promise<number> {
  return prisma.membership.count({ where: { orgId, role: "OWNER" } });
}

// Change a member's role.
export const PATCH = handler(async (req, ctx) => {
  const session = await requireSession(req);
  assertCsrf(req);
  const { orgId, userId } = ids(ctx);
  const me = await requirePermission(session, orgId, "member:update");
  const { role } = await parseBody(req, updateRoleSchema);
  const newRole = role as MembershipRole;

  const target = await prisma.membership.findUnique({ where: { userId_orgId: { userId, orgId } } });
  if (!target) throw NotFound("Member not found");

  // Only an owner may grant or revoke OWNER.
  if ((newRole === "OWNER" || target.role === "OWNER") && me.role !== "OWNER") {
    throw Forbidden("Only an owner can change owner roles");
  }
  // Never demote the final owner.
  if (target.role === "OWNER" && newRole !== "OWNER" && (await ownerCount(orgId)) <= 1) {
    throw BadRequest("An organization must keep at least one owner");
  }

  const updated = await prisma.membership.update({
    where: { userId_orgId: { userId, orgId } },
    data: { role: newRole },
  });
  await writeAudit({ userId: session.userId, orgId, action: "member.role_changed", target: userId.toString(), meta: { role: newRole } });
  return ok({ userId, role: updated.role });
});

// Remove a member.
export const DELETE = handler(async (req, ctx) => {
  const session = await requireSession(req);
  assertCsrf(req);
  const { orgId, userId } = ids(ctx);
  const me = await requirePermission(session, orgId, "member:delete");

  const target = await prisma.membership.findUnique({ where: { userId_orgId: { userId, orgId } } });
  if (!target) throw NotFound("Member not found");
  if (target.role === "OWNER" && me.role !== "OWNER") throw Forbidden("Only an owner can remove an owner");
  if (target.role === "OWNER" && (await ownerCount(orgId)) <= 1) {
    throw BadRequest("Cannot remove the last owner");
  }

  await prisma.membership.delete({ where: { userId_orgId: { userId, orgId } } });
  await writeAudit({ userId: session.userId, orgId, action: "member.removed", target: userId.toString() });
  return ok({ removed: true });
});
