import { cookies } from "next/headers";
import { handler, ok } from "@/lib/http";
import { revokeRefreshToken } from "@/lib/auth/tokens";
import { clearAuthCookies, REFRESH_COOKIE } from "@/lib/auth/cookies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async () => {
  const raw = (await cookies()).get(REFRESH_COOKIE)?.value;
  if (raw) await revokeRefreshToken(raw);
  const res = ok({ loggedOut: true });
  clearAuthCookies(res);
  return res;
});
