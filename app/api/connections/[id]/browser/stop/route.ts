// Closes the remote login window without connecting (dialog cancelled).
import { prisma } from "@/lib/db";
import { handler, ok } from "@/lib/http";
import { assertCsrf } from "@/lib/auth/session";
import { ownedBrowserConnection } from "@/lib/connections/owned";
import { stopSession } from "@/lib/connections/browser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req, ctx: { params: { id: string } }) => {
  assertCsrf(req);
  const { connection } = await ownedBrowserConnection(req, ctx.params.id);
  await stopSession(connection.id);
  if (connection.status === "PENDING") {
    await prisma.platformConnection.update({ where: { id: connection.id }, data: { status: "DISCONNECTED" } });
  }
  return ok({ stopped: true });
});
