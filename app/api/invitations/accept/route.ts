import { prisma } from "@/lib/db";
import { handler, ok, parseBody, BadRequest, Forbidden } from "@/lib/http";
import { requireSession, assertCsrf } from "@/lib/auth/session";
import { acceptInviteSchema } from "@/lib/validation";
import { hashToken } from "@/lib/auth/jwt";
import { setActiveOrg } from "@/lib/auth/cookies";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  const session = await requireSession(req);
  assertCsrf(req);
  const { token } = await parseBody(req, acceptInviteSchema);

  const invite = await prisma.invitation.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!invite || invite.acceptedAt || invite.expiresAt.getTime() < Date.now()) {
    throw BadRequest("Invalid or expired invitation");
  }

  // The invitation is bound to an email; the accepting account must match it.
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || user.email !== invite.email.toLowerCase()) {
    throw Forbidden("This invitation was sent to a different email address");
  }

  await prisma.$transaction(async (tx) => {
    await tx.membership.upsert({
      where: { userId_orgId: { userId: user.id, orgId: invite.orgId } },
      create: { userId: user.id, orgId: invite.orgId, role: invite.role },
      update: { role: invite.role },
    });
    await tx.invitation.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
  });
  await writeAudit({ userId: user.id, orgId: invite.orgId, action: "invitation.accepted" });

  const res = ok({ orgId: invite.orgId, role: invite.role });
  setActiveOrg(res, invite.orgId.toString());
  return res;
});
