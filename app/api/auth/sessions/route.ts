import { prisma } from "@/lib/db";
import { handler, ok, BadRequest } from "@/lib/http";
import { requireSession, assertCsrf } from "@/lib/auth/session";
import { listActiveSessions } from "@/lib/auth/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  const session = await requireSession(req);
  return ok({ sessions: await listActiveSessions(session.userId) });
});

// Revoke a single session by its id (must belong to the caller).
export const DELETE = handler(async (req) => {
  const session = await requireSession(req);
  assertCsrf(req);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw BadRequest("Session id required");
  await prisma.refreshToken.updateMany({
    where: { id: BigInt(id), userId: session.userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return ok({ revoked: true });
});
