import { prisma } from "@/lib/db";
import { handler, ok, parseBody } from "@/lib/http";
import { requestResetSchema } from "@/lib/validation";
import { createVerificationToken } from "@/lib/auth/verification";
import { sendMail, resetPasswordLink } from "@/lib/mailer";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  await rateLimit(`reset-req:${clientIp(req)}`, 5, 900);
  const { email } = await parseBody(req, requestResetSchema);
  const user = await prisma.user.findUnique({ where: { email } });
  // Do not reveal whether the email exists (anti-enumeration).
  if (user) {
    const token = await createVerificationToken(user.id, "PASSWORD_RESET", 3600);
    await sendMail(email, "Reset your password", `Reset: ${resetPasswordLink(token)}`);
  }
  return ok({ message: "If that email exists, a reset link has been sent." });
});
