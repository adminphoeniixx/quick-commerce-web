import { prisma } from "@/lib/db";
import { handler, ok, parseBody, Unauthorized } from "@/lib/http";
import { loginSchema } from "@/lib/validation";
import { verifyPassword } from "@/lib/auth/password";
import { issueSession } from "@/lib/auth/issue";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  const ip = clientIp(req);
  const body = await parseBody(req, loginSchema);
  // Brute-force protection: per-IP and per-account.
  await rateLimit(`login:ip:${ip}`, 20, 900);
  await rateLimit(`login:acct:${body.email}`, 8, 900);

  const user = await prisma.user.findUnique({ where: { email: body.email } });
  const good = user ? await verifyPassword(user.passwordHash, body.password) : false;
  if (!user || !good) {
    await writeAudit({ userId: user?.id ?? null, action: "auth.login.failed", ip, meta: { email: body.email } });
    throw Unauthorized("Invalid email or password");
  }

  const firstMembership = await prisma.membership.findFirst({
    where: { userId: user.id },
    orderBy: { id: "asc" },
  });
  const activeOrgId = firstMembership?.orgId ?? null;

  await writeAudit({ userId: user.id, orgId: activeOrgId, action: "auth.login", ip });

  const res = ok({
    id: user.id, email: user.email, fullName: user.fullName,
    emailVerified: user.emailVerified, isSuperAdmin: user.isSuperAdmin, activeOrgId,
  });
  await issueSession(res, user, activeOrgId);
  return res;
});
