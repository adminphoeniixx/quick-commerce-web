import { prisma } from "@/lib/db";
import { handler, ok } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { requireSuperAdmin } from "@/lib/rbac/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  const session = await requireSession(req);
  requireSuperAdmin(session);

  const [users, organizations, memberships, connections, imports, recentUsers, recentOrganizations] = await Promise.all([
    prisma.user.count(),
    prisma.organization.count({ where: { deletedAt: null } }),
    prisma.membership.count(),
    prisma.platformConnection.count(),
    prisma.importJob.count(),
    prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: 8, select: { id: true, email: true, fullName: true, isSuperAdmin: true, emailVerified: true, createdAt: true } }),
    prisma.organization.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, name: true, createdAt: true, _count: { select: { memberships: true, connections: true } } } }),
  ]);

  return ok({ counts: { users, organizations, memberships, connections, imports }, recentUsers, recentOrganizations });
});
