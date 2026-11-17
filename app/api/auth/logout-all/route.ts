import { handler, ok } from "@/lib/http";
import { requireSession, assertCsrf } from "@/lib/auth/session";
import { revokeAllForUser } from "@/lib/auth/tokens";
import { clearAuthCookies } from "@/lib/auth/cookies";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  const session = await requireSession(req);
  assertCsrf(req);
  await revokeAllForUser(session.userId);
  await writeAudit({ userId: session.userId, action: "auth.logout_all" });
  const res = ok({ loggedOut: true });
  clearAuthCookies(res);
  return res;
});
