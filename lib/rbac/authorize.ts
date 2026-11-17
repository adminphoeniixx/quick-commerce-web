// Tenant + permission guards. Membership is always verified against the DB —
// an orgId from the client is never trusted on its own.
import { prisma } from "@/lib/db";
import type { Membership } from "@prisma/client";
import type { Session } from "@/lib/auth/session";
import { roleHasPermission, type Permission } from "./permissions";
import { Forbidden, NotFound } from "@/lib/http";

export async function getMembership(userId: bigint, orgId: bigint): Promise<Membership | null> {
  return prisma.membership.findUnique({ where: { userId_orgId: { userId, orgId } } });
}

/** Verify the user belongs to the (live) org; returns the membership or throws. */
export async function requireMembership(session: Session, orgId: bigint): Promise<Membership> {
  const m = await getMembership(session.userId, orgId);
  if (!m) throw Forbidden("You are not a member of this organization");
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { deletedAt: true } });
  if (!org || org.deletedAt) throw NotFound("Organization not found");
  return m;
}

/** Verify membership AND that the role grants the permission. */
export async function requirePermission(
  session: Session,
  orgId: bigint,
  permission: Permission,
): Promise<Membership> {
  const m = await requireMembership(session, orgId);
  if (!roleHasPermission(m.role, permission)) throw Forbidden(`Missing permission: ${permission}`);
  return m;
}

/**
 * Resolve the org to operate on: an explicit id (verified) wins, otherwise the
 * active-org cookie. Membership is always checked by the caller's guard.
 */
export function resolveOrgId(session: Session, explicit?: string | null): bigint {
  if (explicit) {
    try { return BigInt(explicit); } catch { throw NotFound("Organization not found"); }
  }
  if (session.activeOrgId) return session.activeOrgId;
  throw Forbidden("No active organization selected");
}

export function requireSuperAdmin(session: Session): void {
  if (!session.isSuperAdmin) throw Forbidden("Platform administrator access required");
}
