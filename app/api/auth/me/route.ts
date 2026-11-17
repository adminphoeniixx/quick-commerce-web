import { prisma } from "@/lib/db";
import { handler, ok, Unauthorized } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { ROLE_PERMISSIONS } from "@/lib/rbac/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  const session = await requireSession(req);
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, fullName: true, emailVerified: true, isSuperAdmin: true },
  });
  if (!user) throw Unauthorized();

  const memberships = await prisma.membership.findMany({
    where: { userId: session.userId },
    select: { orgId: true, role: true, org: { select: { name: true } } },
  });

  const active = session.activeOrgId
    ? memberships.find((m) => m.orgId === session.activeOrgId) ?? null
    : null;

  return ok({
    user,
    activeOrgId: session.activeOrgId,
    organizations: memberships.map((m) => ({ id: m.orgId, name: m.org.name, role: m.role })),
    permissions: active ? ROLE_PERMISSIONS[active.role] : [],
  });
});
