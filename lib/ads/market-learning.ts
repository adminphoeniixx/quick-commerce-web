// Market learning (phase 2A): what blinkit.com search history says about each keyword.
// Joins daily search observations (own organic rank, own vs competitor price, competitor stock-outs,
// ad crowding) with the keyword's daily Ads sales and learns robust sensitivities.
// Correlational evidence for the agents, never a gate: rank and price also move with demand.
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export const MARKET_HISTORY_DAYS = 90;
export const MIN_SAMPLE_DAYS = 10;
const STOCKOUT_SHARE = 0.2;

export interface MarketDay { sales: number; organicRank: number | null; priceGapPct: number | null; competitorSoldOutShare: number | null; adShareTop10: number | null }
export type Confidence = "insufficient" | "low" | "medium" | "high";

// ───────────────────────────── pure math (unit-tested) ─────────────────────────────

/** Theil–Sen slope: median of pairwise slopes. Robust to outliers; null with < 3 distinct x values. */
export function theilSen(points: { x: number; y: number }[]) {
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    const dx = points[j].x - points[i].x;
    if (dx !== 0) slopes.push((points[j].y - points[i].y) / dx);
  }
  if (new Set(points.map((p) => p.x)).size < 3 || !slopes.length) return null;
  slopes.sort((a, b) => a - b);
  const m = Math.floor(slopes.length / 2);
  return slopes.length % 2 ? slopes[m] : (slopes[m - 1] + slopes[m]) / 2;
}

export function confidenceFor(sampleDays: number): Confidence {
  return sampleDays >= 30 ? "high" : sampleDays >= 15 ? "medium" : sampleDays >= MIN_SAMPLE_DAYS ? "low" : "insufficient";
}

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
const round = (v: number | null, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

/** Sensitivities are expressed as % of mean daily sales so keywords of any size compare. */
export function insightFromDays(days: MarketDay[]) {
  const sampleDays = days.length, confidence = confidenceFor(sampleDays), meanSales = mean(days.map((d) => d.sales)) ?? 0;
  const empty = { sampleDays, confidence, meanDailySales: round(meanSales)!, avgOrganicRank: null, rankSensitivityPct: null, avgPriceGapPct: null, priceSensitivityPct: null, stockoutUpliftPct: null, adShareTop10: null };
  if (confidence === "insufficient" || meanSales <= 0) return { ...empty, confidence: "insufficient" as Confidence };
  const ranked = days.filter((d) => d.organicRank != null), priced = days.filter((d) => d.priceGapPct != null);
  const rankSlope = ranked.length >= MIN_SAMPLE_DAYS ? theilSen(ranked.map((d) => ({ x: d.organicRank!, y: d.sales }))) : null;
  const priceSlope = priced.length >= MIN_SAMPLE_DAYS ? theilSen(priced.map((d) => ({ x: d.priceGapPct!, y: d.sales }))) : null;
  const withShare = days.filter((d) => d.competitorSoldOutShare != null);
  const out = withShare.filter((d) => d.competitorSoldOutShare! >= STOCKOUT_SHARE).map((d) => d.sales), normal = withShare.filter((d) => d.competitorSoldOutShare! < STOCKOUT_SHARE).map((d) => d.sales);
  const outMean = out.length >= 3 ? mean(out) : null, normalMean = normal.length >= 3 ? mean(normal) : null;
  return {
    ...empty,
    avgOrganicRank: round(mean(ranked.map((d) => d.organicRank!)), 1),
    rankSensitivityPct: rankSlope == null ? null : round((rankSlope / meanSales) * 100, 1),
    avgPriceGapPct: round(mean(priced.map((d) => d.priceGapPct!)), 1),
    priceSensitivityPct: priceSlope == null ? null : round((priceSlope / meanSales) * 100, 1),
    stockoutUpliftPct: outMean != null && normalMean ? round(((outMean - normalMean) / normalMean) * 100, 1) : null,
    adShareTop10: round(mean(days.filter((d) => d.adShareTop10 != null).map((d) => d.adShareTop10!)), 2),
  };
}

const median = (v: number[]) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** One day of search observations for a keyword → own rank, price gap, competitor stock-out share, ad share. */
export function summarizeSearchDay(rows: { rank: number; organicRank: number | null; price: number | null; isOwn: boolean; isAd: boolean; soldOut: boolean }[]) {
  const own = rows.filter((r) => r.isOwn), comp = rows.filter((r) => !r.isOwn), top10 = rows.filter((r) => r.rank <= 10), compTop10 = top10.filter((r) => !r.isOwn);
  const ownRanks = own.map((r) => r.organicRank).filter((r): r is number => r != null);
  const ownPrice = median(own.map((r) => r.price).filter((p): p is number => p != null && p > 0)), compPrice = median(comp.map((r) => r.price).filter((p): p is number => p != null && p > 0));
  return {
    organicRank: ownRanks.length ? Math.min(...ownRanks) : null,
    priceGapPct: ownPrice != null && compPrice ? ((ownPrice - compPrice) / compPrice) * 100 : null,
    competitorSoldOutShare: compTop10.length ? compTop10.filter((r) => r.soldOut).length / compTop10.length : null,
    adShareTop10: top10.length ? top10.filter((r) => r.isAd).length / top10.length : null,
  };
}

// ───────────────────────────── pipeline ─────────────────────────────

export async function computeMarketInsights(orgId: bigint, brandId: bigint) {
  const platforms = await prisma.platform.findMany({ where: { slug: { in: ["blinkit", "blinkit-ads"] } }, select: { id: true, slug: true } });
  const seller = platforms.find((p) => p.slug === "blinkit")?.id, ads = platforms.find((p) => p.slug === "blinkit-ads")?.id;
  if (!seller || !ads) return { keywords: 0 };
  const since = new Date(Date.now() - MARKET_HISTORY_DAYS * 86_400_000);
  const [obs, sales] = await Promise.all([
    prisma.searchListingObservation.findMany({ where: { brandId, platformId: seller, snapshotDate: { gte: since } }, select: { keyword: true, snapshotDate: true, rank: true, organicRank: true, price: true, isOwn: true, isAd: true, soldOut: true } }),
    prisma.$queryRaw<{ kw: string; date: Date; sales: unknown }[]>`
      SELECT LOWER(label) AS kw, date, SUM("directSales" + "indirectSales") AS sales FROM "AdKeywordDaily"
      WHERE "brandId" = ${brandId} AND "platformId" = ${ads} AND dimension = 'keyword' AND date >= ${since} GROUP BY 1, 2`,
  ]);
  const salesBy = new Map(sales.map((s) => [`${s.kw}|${s.date.toISOString().slice(0, 10)}`, Number(s.sales)]));
  const byDay = new Map<string, typeof obs>();
  for (const o of obs) { const k = `${o.keyword.toLowerCase()}|${o.snapshotDate.toISOString().slice(0, 10)}`; (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(o); }
  const byKeyword = new Map<string, MarketDay[]>();
  for (const [k, rows] of byDay) {
    const daySales = salesBy.get(k);
    if (daySales == null) continue; // only days where both the web snapshot and Ads sales exist
    const kw = k.split("|")[0];
    (byKeyword.get(kw) ?? byKeyword.set(kw, []).get(kw)!).push({ sales: daySales, ...summarizeSearchDay(rows) });
  }
  for (const [keyword, days] of byKeyword) {
    const insight = insightFromDays(days);
    await prisma.keywordMarketInsight.upsert({ where: { brandId_keyword: { brandId, keyword } }, create: { orgId, brandId, keyword, ...insight }, update: insight });
  }
  logger.info("growth.market_learned", { brandId: brandId.toString(), keywords: byKeyword.size });
  return { keywords: byKeyword.size };
}

/** Usable insights (confidence ≥ low) keyed by lower-case keyword, compact for agent evidence. */
export async function marketInsightsFor(brandId: bigint) {
  const rows = await prisma.keywordMarketInsight.findMany({ where: { brandId, confidence: { not: "insufficient" } } });
  const map = new Map(rows.map((r) => [r.keyword, { sampleDays: r.sampleDays, confidence: r.confidence, avgOrganicRank: r.avgOrganicRank, rankSensitivityPct: r.rankSensitivityPct, avgPriceGapPct: r.avgPriceGapPct, priceSensitivityPct: r.priceSensitivityPct, stockoutUpliftPct: r.stockoutUpliftPct, adShareTop10: r.adShareTop10 }]));
  return (keyword: string) => map.get(keyword.toLowerCase()) ?? null;
}
export type MarketInsight = NonNullable<ReturnType<Awaited<ReturnType<typeof marketInsightsFor>>>>;

export async function topMarketInsights(brandId: bigint, take = 10) {
  return prisma.keywordMarketInsight.findMany({ where: { brandId }, orderBy: [{ meanDailySales: "desc" }], take });
}
