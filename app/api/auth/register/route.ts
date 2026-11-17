import { prisma } from "@/lib/db";
import { handler, ok, parseBody, Conflict } from "@/lib/http";
import { registerSchema } from "@/lib/validation";
import { hashPassword } from "@/lib/auth/password";
import { issueSession } from "@/lib/auth/issue";
import { createVerificationToken } from "@/lib/auth/verification";
import { sendMail, verifyEmailLink } from "@/lib/mailer";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  await rateLimit(`register:${clientIp(req)}`, 10, 3600);
  const body = await parseBody(req, registerSchema);

  const existing = await prisma.user.findUnique({ where: { email: body.email } });
  if (existing) throw Conflict("An account with this email already exists");

  const passwordHash = await hashPassword(body.password);

  const { user, activeOrgId } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: body.email, fullName: body.fullName, passwordHash },
    });
    let activeOrgId: bigint | null = null;
    if (body.organizationName) {
      const org = await tx.organization.create({ data: { name: body.organizationName } });
      await tx.membership.create({ data: { userId: user.id, orgId: org.id, role: "OWNER" } });
      activeOrgId = org.id;
    }
    return { user, activeOrgId };
  });

  const token = await createVerificationToken(user.id, "EMAIL_VERIFY", 86400);
  await sendMail(user.email, "Verify your email", `Verify: ${verifyEmailLink(token)}`);
  await writeAudit({ userId: user.id, orgId: activeOrgId, action: "auth.register", ip: clientIp(req) });

  const res = ok(
    { id: user.id, email: user.email, fullName: user.fullName, emailVerified: user.emailVerified, activeOrgId },
    { status: 201 },
  );
  await issueSession(res, user, activeOrgId);
  return res;
});
