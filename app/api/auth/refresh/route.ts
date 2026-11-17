import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { handler, ok, fail, Unauthorized } from "@/lib/http";
import { rotateRefreshToken } from "@/lib/auth/tokens";
import { signAccessToken } from "@/lib/auth/jwt";
import { setAuthCookies, newCsrfToken, clearAuthCookies, REFRESH_COOKIE } from "@/lib/auth/cookies";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  await rateLimit(`refresh:${clientIp(req)}`, 60, 900);
  const raw = (await cookies()).get(REFRESH_COOKIE)?.value;
  if (!raw) throw Unauthorized("No refresh token");

  const result = await rotateRefreshToken(raw);
  if (!result.ok) {
    const out = fail(Unauthorized(result.reason === "reuse" ? "Session revoked" : "Invalid session"));
    clearAuthCookies(out);
    return out;
  }

  const user = await prisma.user.findUnique({ where: { id: result.userId } });
  if (!user) throw Unauthorized();

  const access = await signAccessToken({ sub: user.id.toString(), email: user.email, sa: user.isSuperAdmin });
  const res = ok({ refreshed: true });
  setAuthCookies(res, { access, refresh: result.token, csrf: newCsrfToken() });
  return res;
});
