// Completes "Connect": verifies the login, saves the session and starts the first full
// sync (every sales range the panel offers + the product list). Later syncs are manual.
import { prisma } from "@/lib/db";
import { handler, ok, BadRequest } from "@/lib/http";
import { assertCsrf } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit";
import { ownedBrowserConnection } from "@/lib/connections/owned";
import { sessionState, stopSession } from "@/lib/connections/browser";
import { registerSchedule } from "@/lib/connections/scheduler";
import { queuesEnabled } from "@/lib/queue/connection";
import { scheduledQueue } from "@/lib/queue/queues";
import { runBrowserSync } from "@/lib/connections/sync";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req, ctx: { params: { id: string } }) => {
  assertCsrf(req);
  const { session, connection: c } = await ownedBrowserConnection(req, ctx.params.id);
  const state = await sessionState(c.id);
  if (!state.loggedIn) throw BadRequest(`Not logged in to ${c.platform.name} yet`);
  await stopSession(c.id); // closing the window flushes cookies to the saved profile

  await prisma.platformConnection.update({ where: { id: c.id }, data: { status: "CONNECTED", lastVerifiedAt: new Date(), lastError: null, authFailures: 0 } });
  // Keep session warm with a lightweight check. Two confirmed failures are
  // required before marking it expired; Blinkit can still revoke its token.
  const existingAuthSchedule = await prisma.syncSchedule.findFirst({ where: { orgId: c.orgId, brandId: c.brandId, platformId: c.platformId, dataType: "auth_health" }, orderBy: { id: "asc" } });
  const authSchedule = existingAuthSchedule
    ? await prisma.syncSchedule.update({ where: { id: existingAuthSchedule.id }, data: { cron: "17 */8 * * *", enabled: true, lastStatus: "registered" } })
    : await prisma.syncSchedule.create({ data: { orgId: c.orgId, brandId: c.brandId, platformId: c.platformId, dataType: "auth_health", cron: "17 */8 * * *", enabled: true, lastStatus: "registered" } });
  await registerSchedule(authSchedule);

  if (queuesEnabled()) {
    await scheduledQueue().add("connection-sync", { connectionId: c.id.toString(), trigger: "connect" }, { attempts: 1 });
  } else {
    runBrowserSync(c.id, "connect").catch((error) => logger.error("browser_sync.inline_failed", { error }));
  }
  await writeAudit({ userId: session.userId, orgId: c.orgId, action: "connection.connected", target: c.id.toString() });
  return ok({ status: "CONNECTED", syncing: true });
});
