import { prisma } from "@/lib/db";
import { handler, ok, parseBody, BadRequest } from "@/lib/http";
import { verifyEmailSchema } from "@/lib/validation";
import { consumeVerificationToken } from "@/lib/auth/verification";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  const { token } = await parseBody(req, verifyEmailSchema);
  const userId = await consumeVerificationToken(token, "EMAIL_VERIFY");
  if (!userId) throw BadRequest("Invalid or expired verification link");
  await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
  await writeAudit({ userId, action: "auth.email_verified" });
  return ok({ verified: true });
});
