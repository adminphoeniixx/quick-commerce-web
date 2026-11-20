// Session keep-alive for the Blinkit browser connections (seller panel + Ads).
// Blinkit expires an idle login, so every SESSION_KEEPALIVE_CRON (default every 15 min) the worker
// opens each connected profile once: the visit keeps the session active and refreshes its cookies.
// A session is only reported expired after two confirmed `login_required` checks in a row; a busy
// profile, a network error or a browser-service restart never counts. A block page or captcha
// pauses the connection (guard.ts) instead, so we never keep poking Blinkit through a block.
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import { sendMail } from "@/lib/mailer";
import { queuesEnabled } from "@/lib/queue/connection";
import { keepaliveQueue } from "@/lib/queue/queues";
import { BROWSER_PLATFORMS, browserSupported, checkSession } from "./browser";
import { BLOCK_CODES, pauseConnection, pauseMessage } from "./guard";

export const KEEPALIVE_JOB = "session-keepalive";
export const EXPIRED_AFTER_FAILURES = 2;
const appUrl = process.env.APP_URL ?? "http://localhost:3000";

export type AuthCheck = { ok: boolean; code?: string };
export type AuthDecision =
  | { kind: "healthy"; failures: 0 }
  | { kind: "suspect"; failures: number }
  | { kind: "expired"; failures: number }
  | { kind: "blocked"; failures: number; code: string }
  | { kind: "skipped"; failures: number; code: string };

/** Pure: what one check result means for the connection. */
export function decideAuthCheck(check: AuthCheck, failures: number): AuthDecision {
  if (check.ok) return { kind: "healthy", failures: 0 };
  const code = check.code ?? "unknown";
  if (code === "login_required") {
    const next = failures + 1;
    return next >= EXPIRED_AFTER_FAILURES ? { kind: "expired", failures: next } : { kind: "suspect", failures: next };
  }
  if (BLOCK_CODES.has(code)) return { kind: "blocked", failures, code };
  return { kind: "skipped", failures, code }; // busy, browser_unavailable, timeouts: try again next round
}

export const expiredMessage = (platformName: string) => `${platformName} login expired. Click "Reconnect" to log in again.`;

type Conn = { id: bigint; orgId: bigint; brandId: bigint; status: string; authFailures: number; platform: { slug: string; name: string }; brand?: { name: string } | null };

/** Runs one check and stores the outcome. Returns a short status line. */
export async function checkAndRecord(conn: Conn): Promise<string> {
  const check = await checkSession(conn.id, conn.platform.slug).catch(() => ({ ok: false, code: "browser_unavailable" }));
  const d = decideAuthCheck(check, conn.authFailures);
  const now = new Date();
  if (d.kind === "healthy") {
    await prisma.platformConnection.update({ where: { id: conn.id }, data: { lastAuthCheckAt: now, authFailures: 0, lastVerifiedAt: now, status: "CONNECTED", lastError: null } });
    if (conn.status !== "CONNECTED") await writeAudit({ orgId: conn.orgId, action: "connection.session_recovered", target: conn.id.toString() });
    return "session healthy";
  }
  if (d.kind === "blocked") {
    await prisma.platformConnection.update({ where: { id: conn.id }, data: { lastAuthCheckAt: now } });
    await pauseConnection(conn, d.code, "session keep-alive");
    return `paused: ${d.code}`;
  }
  if (d.kind === "skipped") return `skipped: ${d.code}`;
  if (d.kind === "suspect") {
    await prisma.platformConnection.update({ where: { id: conn.id }, data: { lastAuthCheckAt: now, authFailures: d.failures } });
    return `auth check ${d.failures}/${EXPIRED_AFTER_FAILURES} failed: login_required`;
  }
  await prisma.platformConnection.update({ where: { id: conn.id }, data: { lastAuthCheckAt: now, authFailures: d.failures, status: "ERROR", lastError: expiredMessage(conn.platform.name) } });
  if (conn.status === "CONNECTED") {
    await writeAudit({ orgId: conn.orgId, action: "connection.session_expired", target: conn.id.toString() });
    await notifyExpired(conn).catch((error) => logger.error("keepalive.notify_failed", { error, connectionId: conn.id.toString() }));
  }
  return "session expired";
}

async function notifyExpired(conn: Conn) {
  const admins = await prisma.membership.findMany({ where: { orgId: conn.orgId, role: { in: ["OWNER", "ORG_ADMIN"] } }, select: { user: { select: { email: true } } } });
  const brand = conn.brand?.name ? ` (${conn.brand.name})` : "";
  for (const m of admins) {
    await sendMail(m.user.email, `${conn.platform.name}${brand}: login expired`,
      `Blinkit ended the saved ${conn.platform.name} session${brand}. Syncs and agent actions for it are on hold.\n\nLog in again: ${appUrl}/dashboard/connections (click "Reconnect").`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One keep-alive round over every Blinkit browser connection. Sequential, with a small random gap. */
export async function runSessionKeepalive(): Promise<string> {
  const rows = await prisma.platformConnection.findMany({
    where: { status: { in: ["CONNECTED", "ERROR"] }, platform: { slug: { in: [...BROWSER_PLATFORMS] } } },
    select: { id: true, orgId: true, brandId: true, status: true, authFailures: true, pausedUntil: true, pauseReason: true, platform: { select: { slug: true, name: true } }, brand: { select: { name: true } } },
    orderBy: { id: "asc" },
  });
  const counts: Record<string, number> = {};
  for (const [i, c] of rows.entries()) {
    if (!browserSupported(c.platform.slug) || pauseMessage(c)) { counts.paused = (counts.paused ?? 0) + 1; continue; }
    if (i > 0) await sleep(5_000 + Math.floor(Math.random() * 20_000));
    const line = await checkAndRecord(c).catch((error) => { logger.error("keepalive.check_failed", { error, connectionId: c.id.toString() }); return "error"; });
    const key = line.split(":")[0];
    counts[key] = (counts[key] ?? 0) + 1;
  }
  logger.info("keepalive.round", { connections: rows.length, ...counts });
  return JSON.stringify(counts);
}

export async function registerSessionKeepalive(): Promise<boolean> {
  if (!queuesEnabled()) return false;
  const pattern = process.env.SESSION_KEEPALIVE_CRON ?? "*/15 * * * *";
  const queue = keepaliveQueue();
  for (const r of await queue.getRepeatableJobs()) if (r.name === KEEPALIVE_JOB && r.pattern !== pattern) await queue.removeRepeatableByKey(r.key);
  await queue.add(KEEPALIVE_JOB, {}, { jobId: KEEPALIVE_JOB, repeat: { pattern }, attempts: 1, removeOnComplete: { count: 50 }, removeOnFail: { count: 50 } });
  return true;
}
