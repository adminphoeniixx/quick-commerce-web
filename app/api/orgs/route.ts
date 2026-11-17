import { prisma } from "@/lib/db";
import { handler, ok, parseBody } from "@/lib/http";
import { requireSession, assertCsrf } from "@/lib/auth/session";
import { createOrgSchema } from "@/lib/validation";
import { setActiveOrg } from "@/lib/auth/cookies";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// List organizations the caller belongs to.
export const GET = handler(async (req) => {
  const session = await requireSession(req);
  const memberships = await prisma.membership.findMany({
    where: { userId: session.userId, org: { deletedAt: null } },
    select: { role: true, org: { select: { id: true, name: true, createdAt: true } } },
    orderBy: { id: "asc" },
  });
  return ok({
    organizations: memberships.map((m) => ({ ...m.org, role: m.role })),
    activeOrgId: session.activeOrgId,
  });
});

// Create an organization; the creator becomes OWNER and it becomes active.
export const POST = handler(async (req) => {
  const session = await requireSession(req);
  assertCsrf(req);
  const { name } = await parseBody(req, createOrgSchema);

  const org = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name } });
    await tx.membership.create({ data: { userId: session.userId, orgId: org.id, role: "OWNER" } });
    return org;
  });
  await writeAudit({ userId: session.userId, orgId: org.id, action: "org.created", target: name });

  const res = ok({ id: org.id, name: org.name, role: "OWNER" }, { status: 201 });
  setActiveOrg(res, org.id.toString());
  return res;
});
