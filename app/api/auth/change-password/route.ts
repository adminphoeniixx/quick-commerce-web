import { prisma } from "@/lib/db";
import { handler, ok, parseBody, Unauthorized, BadRequest } from "@/lib/http";
import { changePasswordSchema } from "@/lib/validation";
import { requireSession, assertCsrf } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { revokeAllForUser } from "@/lib/auth/tokens";
import { issueSession } from "@/lib/auth/issue";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  const session = await requireSession(req);
  assertCsrf(req);
  const { currentPassword, newPassword } = await parseBody(req, changePasswordSchema);

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) throw Unauthorized();
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw BadRequest("Current password is incorrect");
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  await revokeAllForUser(user.id); // revoke every session…
  await writeAudit({ userId: user.id, action: "auth.password_changed" });

  const res = ok({ changed: true });
  await issueSession(res, user, session.activeOrgId); // …then re-issue for this device
  return res;
});
