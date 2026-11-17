import { z } from "zod";
import { prisma } from "@/lib/db";
import { handler, ok, parseBody, NotFound, BadRequest, Forbidden } from "@/lib/http";
import { requireSession, assertCsrf } from "@/lib/auth/session";
import { requireMembership, requirePermission } from "@/lib/rbac/authorize";
import { updateOrgSchema } from "@/lib/validation";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function orgIdOf(ctx: { params: { id: string } }): bigint {
  try { return BigInt(ctx.params.id); } catch { throw NotFound("Organization not found"); }
}

export const GET = handler(async (req, ctx) => {
  const session = await requireSession(req);
  const orgId = orgIdOf(ctx);
  const membership = await requireMembership(session, orgId); // tenant isolation
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, createdAt: true, _count: { select: { memberships: true, brands: true } } },
  });
  if (!org) throw NotFound("Organization not found");
  return ok({ ...org, role: membership.role });
});

export const PATCH = handler(async (req, ctx) => {
  const session = await requireSession(req);
  assertCsrf(req);
  const orgId = orgIdOf(ctx);
  await requirePermission(session, orgId, "organization:update");
  const { name } = await parseBody(req, updateOrgSchema);
  const org = await prisma.organization.update({ where: { id: orgId }, data: { name } });
  await writeAudit({ userId: session.userId, orgId, action: "org.updated" });
  return ok({ id: org.id, name: org.name });
});

// Soft-delete an organization. OWNER only; must confirm by typing the org name.
// Data is retained (deletedAt) per retention policy, then purged by a later job.
const deleteSchema = z.object({ confirm: z.string().min(1) });
export const DELETE = handler(async (req, ctx) => {
  const session = await requireSession(req);
  assertCsrf(req);
  const orgId = orgIdOf(ctx);
  const me = await requireMembership(session, orgId);
  if (me.role !== "OWNER") throw Forbidden("Only an owner can delete the organization");

  const { confirm } = await parseBody(req, deleteSchema);
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, deletedAt: true } });
  if (!org || org.deletedAt) throw NotFound("Organization not found");
  if (confirm !== org.name) throw BadRequest("Confirmation text does not match the organization name");

  await prisma.organization.update({ where: { id: orgId }, data: { deletedAt: new Date() } });
  await writeAudit({ userId: session.userId, orgId, action: "org.deleted", target: org.name });
  return ok({ deleted: true, retentionNote: "Data is retained for 30 days before permanent deletion." });
});
