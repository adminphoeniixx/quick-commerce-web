// Opens the remote login window for a browser-connector platform.
import { prisma } from "@/lib/db";
import { handler, ok } from "@/lib/http";
import { assertCsrf } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit";
import { ownedBrowserConnection } from "@/lib/connections/owned";
import { startSession } from "@/lib/connections/browser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req, ctx: { params: { id: string } }) => {
  assertCsrf(req);
  const { session, connection } = await ownedBrowserConnection(req, ctx.params.id);
  await startSession(connection.id, connection.platform.slug);
  if (connection.status !== "CONNECTED") {
    await prisma.platformConnection.update({ where: { id: connection.id }, data: { status: "PENDING", lastError: null } });
  }
  await writeAudit({ userId: session.userId, orgId: connection.orgId, action: "connection.login_started", target: connection.id.toString() });
  return ok({ started: true });
});
