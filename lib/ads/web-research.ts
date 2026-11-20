// Self-directed web research (phase 2B). When the growth agents lack fresh blinkit.com search data
// for the brand's important keywords, they request one public search run — the existing scraper,
// within the SAME daily limits as people, never the last run of a day — and learn from the result.
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import { pauseMessage, searchPauseMessage } from "@/lib/connections/guard";
import { istDayStart, searchAllowed, searchRunsToday, topAdKeywords, TOP_KEYWORDS } from "@/lib/seo/search-budget";

export const PLAN_WEB_DATA_MAX_AGE_DAYS = 3;
export const DAILY_WEB_DATA_MAX_AGE_DAYS = 1;
export const WAIT_FOR_DATA_MINUTES = 45;
const DAY = 86_400_000;

export interface WebScrapeJob { scrapeOrgId: string; scrapeBrandId: string; connectionId: string; keywords: string[]; location: string }

async function platforms() {
  const rows = await prisma.platform.findMany({ where: { slug: { in: ["blinkit", "blinkit-ads"] } }, select: { id: true, slug: true } });
  return { seller: rows.find((r) => r.slug === "blinkit")?.id ?? null, ads: rows.find((r) => r.slug === "blinkit-ads")?.id ?? null };
}

/** Pure: which keywords' latest web snapshot is missing or older than maxAgeDays, stalest first. */
export function staleKeywords(keywords: string[], latest: Map<string, Date>, now: Date, maxAgeDays: number) {
  return keywords
    .map((k) => ({ k, at: latest.get(k)?.getTime() ?? 0 }))
    .filter((x) => now.getTime() - x.at > maxAgeDays * DAY)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.k);
}

/** Top Ads keywords whose blinkit.com search data is missing or stale. */
export async function webDataGaps(brandId: bigint, maxAgeDays: number, now = new Date(), pool = TOP_KEYWORDS) {
  const p = await platforms();
  if (!p.seller || !p.ads) return [];
  const keywords = await topAdKeywords(brandId, p.ads, pool);
  if (!keywords.length) return [];
  const latest = await prisma.$queryRaw<{ kw: string; at: Date }[]>`
    SELECT LOWER(keyword) AS kw, MAX("observedAt") AS at FROM "SearchListingObservation"
    WHERE "brandId" = ${brandId} AND "platformId" = ${p.seller} AND LOWER(keyword) = ANY(${keywords}) GROUP BY 1`;
  return staleKeywords(keywords, new Map(latest.map((r) => [r.kw, r.at])), now, maxAgeDays).slice(0, TOP_KEYWORDS);
}

/**
 * Queues one agent search run if every safety rule allows it. Returns why not otherwise.
 * Rules: seller connection exists, no block/search pause, a known delivery location, at most one agent
 * run a day, and the run must leave at least one run free for people (per location and in total).
 */
export async function requestAgentSearch(input: { orgId: bigint; brandId: bigint; keywords: string[]; reason: string; planId?: bigint }) {
  if (!input.keywords.length) return { ok: false as const, reason: "no keywords need fresh web data" };
  const p = await platforms();
  if (!p.seller) return { ok: false as const, reason: "Blinkit seller platform is not set up" };
  const connection = await prisma.platformConnection.findUnique({ where: { brandId_platformId: { brandId: input.brandId, platformId: p.seller } }, select: { id: true, pausedUntil: true, pauseReason: true, searchPausedUntil: true } });
  if (!connection) return { ok: false as const, reason: "connect Blinkit (seller panel) to let agents research blinkit.com search" };
  const paused = pauseMessage(connection) ?? searchPauseMessage(connection);
  if (paused) return { ok: false as const, reason: paused };
  const last = await prisma.searchListingObservation.findFirst({ where: { brandId: input.brandId, platformId: p.seller, location: { not: null } }, orderBy: { observedAt: "desc" }, select: { location: true } });
  if (!last?.location) return { ok: false as const, reason: "no delivery location known yet: run one blinkit.com search from Keyword Intelligence first" };
  const [runsToday, agentRunsToday] = await Promise.all([
    searchRunsToday(input.brandId, p.seller),
    prisma.auditLog.count({ where: { action: "growth.web_scrape_requested", target: input.brandId.toString(), createdAt: { gte: istDayStart() } } }),
  ]);
  const allowed = searchAllowed({ location: last.location, runsToday, reserve: 1, agentRunsToday });
  if (!allowed.ok) return allowed;
  const job: WebScrapeJob = { scrapeOrgId: input.orgId.toString(), scrapeBrandId: input.brandId.toString(), connectionId: connection.id.toString(), keywords: input.keywords.slice(0, TOP_KEYWORDS), location: last.location };
  await writeAudit({ orgId: input.orgId, action: "growth.web_scrape_requested", target: input.brandId.toString(), meta: { keywords: job.keywords, location: job.location, reason: input.reason, planId: input.planId?.toString() ?? null } });
  const { queuesEnabled } = await import("@/lib/queue/connection");
  if (queuesEnabled()) {
    const { growthQueue } = await import("@/lib/queue/queues");
    await growthQueue().add("growth-web-scrape", job, { jobId: `growth-web-${input.brandId}-${istDayStart().toISOString().slice(0, 10)}`, attempts: 1 });
  } else setImmediate(() => { runAgentSearch(job).catch((error) => logger.error("growth.web_scrape_failed", { error })); });
  return { ok: true as const, keywords: job.keywords, location: job.location };
}

/** Worker entry: run the public search, learn from it, then let waiting plans continue — whatever the outcome. */
export async function runAgentSearch(job: WebScrapeJob) {
  const orgId = BigInt(job.scrapeOrgId), brandId = BigInt(job.scrapeBrandId);
  let result: string;
  try {
    const { runBrowserSync } = await import("@/lib/connections/sync");
    result = await runBrowserSync(BigInt(job.connectionId), "manual", { sales: false, catalog: false, inventory: false, seo: false, search: { keywords: job.keywords, location: job.location } });
  } catch (error) { result = `error: ${error instanceof Error ? error.message : error}`; }
  logger.info("growth.web_scrape_done", { brandId: job.scrapeBrandId, result: result.slice(0, 200) });
  try {
    const [{ computeMarketInsights }, { learnFromHistory }] = await Promise.all([import("./market-learning"), import("./growth-history")]);
    await computeMarketInsights(orgId, brandId);
    await learnFromHistory(orgId, brandId);
  } catch (error) { logger.error("growth.post_scrape_learning_failed", { brandId: job.scrapeBrandId, error }); }
  await resumeWaitingPlans({ brandId });
  return result;
}

/** Moves WAITING_FOR_DATA plans back to research (for a brand, or all that waited too long). */
export async function resumeWaitingPlans(filter: { brandId?: bigint; waitedLongerThanMinutes?: number }) {
  const plans = await prisma.salesGrowthPlan.findMany({ where: { status: "WAITING_FOR_DATA", ...(filter.brandId ? { brandId: filter.brandId } : {}), ...(filter.waitedLongerThanMinutes ? { updatedAt: { lt: new Date(Date.now() - filter.waitedLongerThanMinutes * 60_000) } } : {}) }, select: { id: true } });
  const { requeueResearch } = await import("./growth-lifecycle");
  for (const p of plans) await requeueResearch(p.id);
  return plans.length;
}
