// "Sync SEO" on Keyword Intelligence: runs the Blinkit seller connection's browser sync with only
// the SEO steps — Seller Hub listing SEO and (optionally) blinkit.com search for the brand's top
// Blinkit Ads keywords at a delivery location. Progress: /api/connections/:id/sync/progress.
import { z } from "zod";
import { prisma } from "@/lib/db";
import { handler, ok, BadRequest, parseBody } from "@/lib/http";
import { assertCsrf, requireSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac/authorize";
import { writeAudit } from "@/lib/audit";
import { adsScope } from "@/lib/ads/queries";
import { browserSupported } from "@/lib/connections/browser";
import { runBrowserSync } from "@/lib/connections/sync";
import { queuesEnabled } from "@/lib/queue/connection";
import { scheduledQueue } from "@/lib/queue/queues";
import { SEARCH_RUNS_PER_DAY_TOTAL, pauseMessage, searchPauseMessage } from "@/lib/connections/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEARCH_RUNS_PER_DAY = 2; // per delivery location
const TOP_KEYWORDS = 10;

const CITY_ALIAS: Record<string, string[]> = { gurugram: ["gurgaon"], gurgaon: ["gurugram"], bengaluru: ["bangalore"], bangalore: ["bengaluru"] };
/** Runs already made today for the city named in a free-text area ("Sector 50 Gurugram" → Gurugram). */
function runsFor(location: string, runsToday: Record<string, number>) {
  const text = location.toLowerCase();
  return Math.max(0, ...Object.entries(runsToday).filter(([city]) => {
    const c = city.toLowerCase();
    return [c, ...(CITY_ALIAS[c] ?? [])].some((n) => n && text.includes(n));
  }).map(([, n]) => n));
}

const istDayStart = () => { const d = new Date(Date.now() + 5.5 * 3600_000); d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() - 5.5 * 3600_000); };

async function context(req: Request) {
  const s = await adsScope(req);
  const seller = s.sellerPlatformId;
  const connection = seller ? await prisma.platformConnection.findUnique({
    where: { brandId_platformId: { brandId: s.brandId, platformId: seller } },
    select: { id: true, status: true, lastError: true, pausedUntil: true, pauseReason: true, searchPausedUntil: true, platform: { select: { name: true, slug: true } } },
  }) : null;
  const to = new Date(), from = new Date(to.getTime() - 30 * 86400_000);
  const keywords = (await prisma.$queryRaw<{ keyword: string }[]>`
    SELECT lower(label) AS keyword FROM "AdKeywordDaily"
    WHERE "brandId" = ${s.brandId} AND "platformId" = ${s.platformId} AND dimension = 'keyword' AND date BETWEEN ${from} AND ${to}
      AND COALESCE("matchType", '') <> 'PLACEMENT' -- "similar products recommendation" etc. are ad slots, not searches
    GROUP BY 1 ORDER BY SUM("directSales" + "indirectSales") DESC, SUM(spend) DESC LIMIT ${TOP_KEYWORDS}`).map((k) => k.keyword);
  // Today's blinkit.com search runs per city, from the panel and the agent MCP alike (one observedAt per run).
  const [runs, last] = seller ? await Promise.all([
    prisma.$queryRaw<{ city: string; n: number }[]>`
      SELECT city, COUNT(DISTINCT "observedAt")::int AS n FROM "SearchListingObservation"
      WHERE "brandId" = ${s.brandId} AND "platformId" = ${seller} AND "observedAt" >= ${istDayStart()} GROUP BY city`,
    prisma.searchListingObservation.findFirst({ where: { brandId: s.brandId, platformId: seller }, orderBy: { observedAt: "desc" }, select: { location: true } }),
  ]) : [[], null];
  // Areas already searched (newest first) for the area dropdown.
  const recent = seller ? (await prisma.$queryRaw<{ location: string }[]>`
    SELECT location FROM "SearchListingObservation" WHERE "brandId" = ${s.brandId} AND "platformId" = ${seller} AND location IS NOT NULL AND location <> ''
    GROUP BY location ORDER BY MAX("observedAt") DESC LIMIT 10`).map((r) => r.location) : [];
  return { s, seller, connection, keywords, runsToday: Object.fromEntries(runs.map((r) => [r.city, r.n])), lastLocation: last?.location ?? null, recent };
}

export const GET = handler(async (req) => {
  const { connection, keywords, runsToday, lastLocation, recent } = await context(req);
  return ok({
    connection: connection && { id: connection.id.toString(), status: connection.status, name: connection.platform.name, lastError: connection.lastError },
    keywords, runsToday, lastLocation, recent, limitPerDay: SEARCH_RUNS_PER_DAY,
    totalToday: Object.values(runsToday).reduce((a, b) => a + b, 0), limitTotalPerDay: SEARCH_RUNS_PER_DAY_TOTAL,
    paused: pauseMessage(connection), searchPaused: searchPauseMessage(connection),
  });
});

const schema = z.object({ search: z.boolean().default(true), location: z.string().trim().max(80).default("") });

export const POST = handler(async (req) => {
  const session = await requireSession(req);
  assertCsrf(req);
  const body = await parseBody(req, schema);
  const { s, connection, keywords, runsToday } = await context(req);
  await requirePermission(session, s.orgId, "integration:create");
  if (!connection || !browserSupported(connection.platform.slug)) throw BadRequest("Connect Blinkit (seller panel) on the Connections page first");
  // Block protection: after a block page / captcha / 429 nothing runs until the pause ends.
  const paused = pauseMessage(connection);
  if (paused) throw BadRequest(paused);
  if (body.search && searchPauseMessage(connection)) throw BadRequest(searchPauseMessage(connection)!);
  // blinkit.com search is public (no login). Only the Seller Hub listing SEO needs the seller login.
  const loggedIn = connection.status === "CONNECTED";
  if (!loggedIn && !body.search) throw BadRequest("Listing SEO needs the Blinkit seller login: reconnect on the Connections page, or tick the blinkit.com search (no login needed)");
  let search: { keywords: string[]; location: string } | undefined;
  if (body.search) {
    if (body.location.length < 3) throw BadRequest("Enter a delivery area + city for the blinkit.com search, e.g. \"Sector 50 Gurugram\"");
    if (!keywords.length) throw BadRequest("No Blinkit Ads keywords yet: sync Blinkit Ads first");
    const total = Object.values(runsToday).reduce((a, b) => a + b, 0);
    if (total >= SEARCH_RUNS_PER_DAY_TOTAL)
      throw BadRequest(`blinkit.com search already ran ${total}x today (all cities); the limit is ${SEARCH_RUNS_PER_DAY_TOTAL} a day to keep your IP safe. Try tomorrow.`);
    if (runsFor(body.location, runsToday) >= SEARCH_RUNS_PER_DAY)
      throw BadRequest(`blinkit.com search already ran ${SEARCH_RUNS_PER_DAY}x today for "${body.location}". Try tomorrow or another area.`);
    search = { keywords, location: body.location };
  }
  const opts = { sales: false, catalog: false, inventory: false, seo: loggedIn, search };
  const since = Date.now();
  if (queuesEnabled()) await scheduledQueue().add("connection-sync", { connectionId: connection.id.toString(), trigger: "manual", opts }, { attempts: 1 });
  else void runBrowserSync(connection.id, "manual", opts);
  await writeAudit({ userId: session.userId, orgId: s.orgId, action: "seo.sync_requested", target: connection.id.toString(), meta: { search: !!search, location: body.location } });
  return ok({ connectionId: connection.id.toString(), since, keywords: search?.keywords ?? [], location: search?.location ?? null, listingSeo: loggedIn });
});
