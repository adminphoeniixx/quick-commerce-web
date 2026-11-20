// blinkit.com search budget, shared by the manual "Sync SEO" button and the growth agents.
// Every run counts against the same per-location and daily-total limits to keep the IP safe.
import { prisma } from "@/lib/db";
import { SEARCH_RUNS_PER_DAY_TOTAL } from "@/lib/connections/guard";

export const SEARCH_RUNS_PER_DAY = 2; // per delivery location
export const TOP_KEYWORDS = 10;
/** Agents may use at most this many runs a day, and must leave at least one run for people. */
export const AGENT_SEARCH_RUNS_PER_DAY = 1;

const CITY_ALIAS: Record<string, string[]> = { gurugram: ["gurgaon"], gurgaon: ["gurugram"], bengaluru: ["bangalore"], bangalore: ["bengaluru"] };

/** Runs already made today for the city named in a free-text area ("Sector 50 Gurugram" → Gurugram). */
export function runsFor(location: string, runsToday: Record<string, number>) {
  const text = location.toLowerCase();
  return Math.max(0, ...Object.entries(runsToday).filter(([city]) => {
    const c = city.toLowerCase();
    return [c, ...(CITY_ALIAS[c] ?? [])].some((n) => n && text.includes(n));
  }).map(([, n]) => n));
}

export const istDayStart = (now = new Date()) => { const d = new Date(now.getTime() + 5.5 * 3600_000); d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() - 5.5 * 3600_000); };

/**
 * Whether a search may run. `reserve` runs are kept free for people (0 for a manual run, 1 for agents),
 * so an agent can never use the last run of the day for a location or overall.
 */
export function searchAllowed(input: { location: string; runsToday: Record<string, number>; reserve?: number; agentRunsToday?: number }): { ok: true } | { ok: false; reason: string } {
  const reserve = input.reserve ?? 0, total = Object.values(input.runsToday).reduce((a, b) => a + b, 0);
  if (reserve > 0 && (input.agentRunsToday ?? 0) >= AGENT_SEARCH_RUNS_PER_DAY) return { ok: false, reason: `agents already used their ${AGENT_SEARCH_RUNS_PER_DAY} blinkit.com search run today` };
  if (reserve > 0 && (total >= SEARCH_RUNS_PER_DAY_TOTAL - reserve || runsFor(input.location, input.runsToday) >= SEARCH_RUNS_PER_DAY - reserve))
    return { ok: false, reason: `an agent run now would leave no blinkit.com search run for people today at "${input.location}"` };
  if (total >= SEARCH_RUNS_PER_DAY_TOTAL)
    return { ok: false, reason: `blinkit.com search already ran ${total}x today (all cities); the limit is ${SEARCH_RUNS_PER_DAY_TOTAL} a day to keep your IP safe. Try tomorrow.` };
  if (runsFor(input.location, input.runsToday) >= SEARCH_RUNS_PER_DAY)
    return { ok: false, reason: `blinkit.com search already ran ${SEARCH_RUNS_PER_DAY}x today for "${input.location}". Try tomorrow or another area.` };
  return { ok: true };
}

/** Today's blinkit.com search runs per city (one observedAt per run), from the panel, the MCP agent and growth agents alike. */
export async function searchRunsToday(brandId: bigint, sellerPlatformId: number, now = new Date()) {
  const runs = await prisma.$queryRaw<{ city: string; n: number }[]>`
    SELECT city, COUNT(DISTINCT "observedAt")::int AS n FROM "SearchListingObservation"
    WHERE "brandId" = ${brandId} AND "platformId" = ${sellerPlatformId} AND "observedAt" >= ${istDayStart(now)} GROUP BY city`;
  return Object.fromEntries(runs.map((r) => [r.city, r.n])) as Record<string, number>;
}

/** The brand's top Blinkit Ads search keywords of the last 30 days (placements are ad slots, not searches). */
export async function topAdKeywords(brandId: bigint, adsPlatformId: number, limit = TOP_KEYWORDS) {
  const to = new Date(), from = new Date(to.getTime() - 30 * 86400_000);
  return (await prisma.$queryRaw<{ keyword: string }[]>`
    SELECT lower(label) AS keyword FROM "AdKeywordDaily"
    WHERE "brandId" = ${brandId} AND "platformId" = ${adsPlatformId} AND dimension = 'keyword' AND date BETWEEN ${from} AND ${to}
      AND COALESCE("matchType", '') <> 'PLACEMENT'
    GROUP BY 1 ORDER BY SUM("directSales" + "indirectSales") DESC, SUM(spend) DESC LIMIT ${limit}`).map((k) => k.keyword);
}
