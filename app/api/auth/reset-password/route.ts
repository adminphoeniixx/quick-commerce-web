import { prisma } from "@/lib/db";
import { handler, ok, parseBody, BadRequest } from "@/lib/http";
import { resetPasswordSchema } from "@/lib/validation";
import { consumeVerificationToken } from "@/lib/auth/verification";
import { hashPassword } from "@/lib/auth/password";
import { revokeAllForUser } from "@/lib/auth/tokens";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  const { token, password } = await parseBody(req, resetPasswordSchema);
  const userId = await consumeVerificationToken(token, "PASSWORD_RESET");
  if (!userId) throw BadRequest("Invalid or expired reset link");

  const passwordHash = await hashPassword(password);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  await revokeAllForUser(userId); // invalidate every existing session
  await writeAudit({ userId, action: "auth.password_reset" });
  return ok({ reset: true });
});
