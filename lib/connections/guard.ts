// Block protection for the Blinkit automations (seller sync, Ads sync, bid changes, blinkit.com
// search). Blinkit sits behind Cloudflare: the way to keep the account and IP safe is to do little,
// slowly, and to stop completely as soon as Blinkit pushes back. Never retry through a block.
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

/** Codes the browser service returns when Blinkit pushes back. */
export const BLOCK_CODES = new Set(["blocked", "captcha", "rate_limited"]);
export const SEARCH_BLOCK_CODES = new Set(["search_blocked", "search_captcha", "search_rate_limited"]);
export const PAUSE_HOURS = 24;
/** A scheduled sync never runs more often than this, whatever cron the user set. */
export const MIN_SCHEDULED_GAP_MS = 6 * 3600_000;
/** blinkit.com search runs per brand per IST day, all cities together (2 per city on top). */
export const SEARCH_RUNS_PER_DAY_TOTAL = 6;
/** Bid changes: applied in batches, a few runs a day, few edits per keyword. */
export const BID_APPLY_RUNS_PER_DAY = 12;
export const BID_CHANGES_PER_DAY = 150;
export const BID_CHANGES_PER_KEYWORD_PER_DAY = 3;
export const BID_APPLY_BATCH_DELAY_MS = 20_000; // approvals within 20s go out in one Blinkit call

type Conn = { id: bigint; orgId: bigint; pausedUntil: Date | null; pauseReason: string | null; searchPausedUntil: Date | null };
const fmt = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

/** null when the connection may touch Blinkit, else the reason it is paused. */
export function pauseMessage(c: Pick<Conn, "pausedUntil" | "pauseReason"> | null | undefined): string | null {
  if (!c?.pausedUntil || c.pausedUntil.getTime() <= Date.now()) return null;
  return `Paused until ${fmt(c.pausedUntil)} IST to protect your Blinkit account: ${c.pauseReason ?? "Blinkit pushed back"}. It resumes by itself.`;
}
export function searchPauseMessage(c: Pick<Conn, "searchPausedUntil"> | null | undefined): string | null {
  if (!c?.searchPausedUntil || c.searchPausedUntil.getTime() <= Date.now()) return null;
  return `blinkit.com search is paused until ${fmt(c.searchPausedUntil)} IST because blinkit.com showed a block page to this server. It resumes by itself.`;
}

/** Stop all automation on this connection for PAUSE_HOURS. */
export async function pauseConnection(c: Pick<Conn, "id" | "orgId">, code: string, detail: string) {
  const until = new Date(Date.now() + PAUSE_HOURS * 3600_000);
  const reason = `${code === "rate_limited" ? "Blinkit said too many requests (HTTP 429)" : code === "captcha" ? "Blinkit showed a captcha" : "Blinkit showed a block page"}${detail ? ` (${detail.slice(0, 120)})` : ""}`;
  await prisma.platformConnection.update({ where: { id: c.id }, data: { pausedUntil: until, pauseReason: reason, lastError: `Paused for ${PAUSE_HOURS}h: ${reason}` } });
  await writeAudit({ orgId: c.orgId, action: "connection.paused_after_block", target: c.id.toString(), meta: { code, until: until.toISOString() } });
  logger.warn("connection.paused_after_block", { connectionId: c.id.toString(), code });
}

/** Stop only the blinkit.com search on this connection for PAUSE_HOURS. */
export async function pauseSearch(c: Pick<Conn, "id" | "orgId">, code: string) {
  const until = new Date(Date.now() + PAUSE_HOURS * 3600_000);
  await prisma.platformConnection.update({ where: { id: c.id }, data: { searchPausedUntil: until } });
  await writeAudit({ orgId: c.orgId, action: "connection.search_paused_after_block", target: c.id.toString(), meta: { code, until: until.toISOString() } });
}

export const istDayStart = () => { const d = new Date(Date.now() + 5.5 * 3600_000); d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() - 5.5 * 3600_000); };
