import { prisma } from "@/lib/db";
import { handler, ok, parseBody, NotFound, Forbidden, Conflict } from "@/lib/http";
import { requireSession, assertCsrf } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac/authorize";
import { inviteSchema } from "@/lib/validation";
import { generateRefreshToken } from "@/lib/auth/jwt";
import { sendMail } from "@/lib/mailer";
import { writeAudit } from "@/lib/audit";
import type { MembershipRole } from "@prisma/client";
import { requireVerifiedEmail } from "@/lib/auth/verified";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function orgIdOf(ctx: { params: { id: string } }): bigint {
  try { return BigInt(ctx.params.id); } catch { throw NotFound("Organization not found"); }
}

// List members + pending invitations.
export const GET = handler(async (req, ctx) => {
  const session = await requireSession(req);
  const orgId = orgIdOf(ctx);
  await requirePermission(session, orgId, "member:read");
  const members = await prisma.membership.findMany({
    where: { orgId },
    select: { role: true, user: { select: { id: true, email: true, fullName: true } } },
    orderBy: { id: "asc" },
  });
  const invites = await prisma.invitation.findMany({
    where: { orgId, acceptedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, email: true, role: true, expiresAt: true },
  });
  return ok({ members, invitations: invites });
});

// Invite a member by email.
export const POST = handler(async (req, ctx) => {
  const session = await requireSession(req);
  assertCsrf(req);
  const orgId = orgIdOf(ctx);
  const me = await requirePermission(session, orgId, "member:create");
  await requireVerifiedEmail(session);
  const { email, role } = await parseBody(req, inviteSchema);

  // Only an OWNER may grant the OWNER role (privilege-escalation guard).
  if (role === "OWNER" && me.role !== "OWNER") throw Forbidden("Only an owner can invite an owner");

  const already = await prisma.membership.findFirst({
    where: { orgId, user: { email } },
  });
  if (already) throw Conflict("That person is already a member");

  const { token, hash } = generateRefreshToken();
  await prisma.invitation.create({
    data: {
      orgId, email, role: role as MembershipRole, tokenHash: hash, invitedByUserId: session.userId,
      expiresAt: new Date(Date.now() + 7 * 86400 * 1000),
    },
  });
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  await sendMail(email, "You've been invited", `Accept: ${appUrl}/accept-invite?token=${token}`);
  await writeAudit({ userId: session.userId, orgId, action: "member.invited", target: email, meta: { role } });
  return ok({ invited: true, email, role }, { status: 201 });
});
