// Learning from scraped history (phase 1B). Past bid changes and campaign launches in the synced
// Blinkit Ads data are treated as natural experiments: before vs after, adjusted by a control group,
// compared with what our forecast method would have predicted. Results feed GrowthActionOutcome
// (source HISTORICAL, half weight) and therefore calibration and agent evidence.
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { bidSalesDelta } from "./growth-planner";
import { forecastRatio, liftAdjustedDelta, refreshCalibration } from "./growth-learning";

export const HISTORY_DAYS = 180;
export const EVENT_WINDOW_DAYS = 14;
export const CPM_CHANGE_MIN_PCT = 8;
export const CPM_HOLD_DAYS = 3;
export const MIN_WINDOW_SPEND = 500;
export const MIN_DAY_IMPRESSIONS = 200;
const DAY = 86_400_000;

export interface DayPoint { date: string; spend: number; impressions: number; sales: number }
export interface CpmChangePoint { date: string; fromCpm: number; toCpm: number; changePct: number }

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, n: number) => iso(new Date(new Date(`${date}T00:00:00Z`).getTime() + n * DAY));
const med = (v: number[]) => { const s = [...v].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const quantile = (values: number[], q: number) => { if (!values.length) return 0; const s = [...values].sort((a, b) => a - b), p = (s.length - 1) * q, l = Math.floor(p), h = Math.ceil(p); return s[l] + (s[h] - s[l]) * (p - l); };

// ───────────────────────────── pure detection & math (unit-tested) ─────────────────────────────

/**
 * Change points in effective CPM (spend / impressions × 1000). A point is the first day of a run of
 * CPM_HOLD_DAYS valid days that all sit ≥ CPM_CHANGE_MIN_PCT away from the median of the previous
 * CPM_HOLD_DAYS valid days, in the same direction. Days with few impressions are ignored as noise.
 * After a detection the scan skips one event window so one bid edit is not reported twice.
 */
export function detectCpmChangePoints(series: DayPoint[]): CpmChangePoint[] {
  const valid = series.filter((d) => d.impressions >= MIN_DAY_IMPRESSIONS && d.spend > 0).map((d) => ({ date: d.date, cpm: (d.spend / d.impressions) * 1000 }));
  const out: CpmChangePoint[] = [];
  let i = CPM_HOLD_DAYS, blockedUntil = "";
  while (i + CPM_HOLD_DAYS <= valid.length) {
    if (valid[i].date < blockedUntil) { i++; continue; }
    const before = med(valid.slice(i - CPM_HOLD_DAYS, i).map((d) => d.cpm)), after = valid.slice(i, i + CPM_HOLD_DAYS).map((d) => d.cpm);
    const moves = after.map((c) => ((c - before) / before) * 100);
    const up = moves.every((m) => m >= CPM_CHANGE_MIN_PCT), down = moves.every((m) => m <= -CPM_CHANGE_MIN_PCT);
    if (up || down) {
      const toCpm = med(after);
      out.push({ date: valid[i].date, fromCpm: before, toCpm, changePct: ((toCpm - before) / before) * 100 });
      blockedUntil = addDays(valid[i].date, EVENT_WINDOW_DAYS); i += CPM_HOLD_DAYS;
    } else i++;
  }
  return out;
}

/** Sum of a series between two dates (inclusive). */
export function windowSum(series: DayPoint[], from: string, to: string) {
  let sales = 0, spend = 0, days = 0;
  for (const d of series) if (d.date >= from && d.date <= to) { sales += d.sales; spend += d.spend; days++; }
  return { sales, spend, days };
}

/** Evaluates one bid event: 14 days before vs 14 days from the change, lift-adjusted by control keywords. */
export function evaluateBidEvent(input: { series: DayPoint[]; control: { before: number; after: number }; date: string; changePct: number; lastDate: string }) {
  const afterEnd = addDays(input.date, EVENT_WINDOW_DAYS - 1);
  if (afterEnd > input.lastDate) return null; // window not complete yet
  const before = windowSum(input.series, addDays(input.date, -EVENT_WINDOW_DAYS), addDays(input.date, -1)), after = windowSum(input.series, input.date, afterEnd);
  if (before.spend < MIN_WINDOW_SPEND || after.spend < MIN_WINDOW_SPEND) return null;
  const controlGrowthPct = input.control.before > 0 ? ((input.control.after - input.control.before) / input.control.before) * 100 : null;
  const direction = input.changePct >= 0 ? "increase" as const : "decrease" as const;
  const salesDelta = liftAdjustedDelta({ beforeSales: before.sales, beforeDays: EVENT_WINDOW_DAYS, afterSales: after.sales, afterDays: EVENT_WINDOW_DAYS, controlGrowthPct });
  const forecast = bidSalesDelta({ sales: before.sales, changePct: input.changePct, action: direction }, EVENT_WINDOW_DAYS, EVENT_WINDOW_DAYS);
  return { direction, before, after, controlGrowthPct, salesDelta, forecast, forecastRatio: forecastRatio(direction, salesDelta, forecast), measuredFrom: input.date, measuredTo: afterEnd };
}

/** The planner's campaign projection (see suggestCampaigns), replayed on a reference campaign's history and the launch's actual spend. */
export function campaignLaunchForecast(reference: { spend: number; sales: number }[], actualSpend: number) {
  const spendDays = reference.filter((d) => d.spend > 0), totalSpend = spendDays.reduce((a, d) => a + d.spend, 0);
  const observed = totalSpend ? spendDays.reduce((a, d) => a + d.sales, 0) / totalSpend : 0;
  const daily = spendDays.map((d) => d.sales / d.spend).filter(Number.isFinite);
  const low = Math.max(0, Math.min(daily.length ? quantile(daily, 0.25) : observed * 0.5, observed * 0.6));
  const high = Math.max(0, Math.min(daily.length ? quantile(daily, 0.75) : observed, observed));
  return { low: actualSpend * low, high: actualSpend * high };
}

// ───────────────────────────── pipeline ─────────────────────────────

type Prefix = { dates: string[]; sales: number[] };
function prefix(series: DayPoint[]): Prefix {
  const dates: string[] = [], sales: number[] = [0];
  for (const d of series) { dates.push(d.date); sales.push(sales[sales.length - 1] + d.sales); }
  return { dates, sales };
}
function prefixSum(p: Prefix, from: string, to: string) {
  const bound = (pred: (d: string) => boolean) => { let lo = 0, hi = p.dates.length; while (lo < hi) { const m = (lo + hi) >> 1; if (pred(p.dates[m])) lo = m + 1; else hi = m; } return lo; };
  return p.sales[bound((d) => d <= to)] - p.sales[bound((d) => d < from)];
}

/** Scans the brand's synced Ads history and records new HISTORICAL outcomes. Idempotent via eventKey. */
export async function learnFromHistory(orgId: bigint, brandId: bigint) {
  const ads = await prisma.platform.findUnique({ where: { slug: "blinkit-ads" }, select: { id: true } });
  if (!ads) return { bidEvents: 0, campaignEvents: 0 };
  const since = new Date(Date.now() - HISTORY_DAYS * DAY);
  const rows = await prisma.$queryRaw<{ campaignId: string; kw: string; match: string | null; date: Date; spend: unknown; impressions: unknown; sales: unknown }[]>`
    SELECT "campaignId", LOWER(label) AS kw, UPPER("matchType") AS match, date, SUM(spend) AS spend, SUM(impressions) AS impressions, SUM("directSales" + "indirectSales") AS sales
    FROM "AdKeywordDaily" WHERE "brandId" = ${brandId} AND "platformId" = ${ads.id} AND dimension = 'keyword' AND date >= ${since}
    GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4`;
  const series = new Map<string, DayPoint[]>();
  let lastDate = "";
  for (const r of rows) {
    const key = `${r.campaignId}|${r.kw}|${r.match ?? ""}`, date = iso(r.date);
    if (date > lastDate) lastDate = date;
    (series.get(key) ?? series.set(key, []).get(key)!).push({ date, spend: Number(r.spend), impressions: Number(r.impressions), sales: Number(r.sales) });
  }

  // Events: exact changes applied through QCP outside growth plans (plan outcomes are recorded separately), then CPM change points.
  const applied = await prisma.adBidChange.findMany({ where: { brandId, platformId: ads.id, status: "APPLIED", growthPlanId: null, appliedAt: { gte: since } }, select: { id: true, campaignId: true, keyword: true, matchType: true, fromCpm: true, toCpm: true, beforeCpm: true, afterCpm: true, appliedAt: true } });
  const planBids = await prisma.adBidChange.findMany({ where: { brandId, growthPlanId: { not: null }, appliedAt: { gte: since } }, select: { campaignId: true, keyword: true, matchType: true, appliedAt: true } });
  type Ev = { key: string; seriesKey: string; date: string; changePct: number; campaignId: string; keyword: string; matchType: string | null };
  const events: Ev[] = [], known = new Map<string, string[]>();
  const mark = (seriesKey: string, date: string) => known.set(seriesKey, [...(known.get(seriesKey) ?? []), date]);
  for (const b of planBids) if (b.appliedAt) mark(`${b.campaignId}|${b.keyword.toLowerCase()}|${b.matchType.toUpperCase()}`, iso(b.appliedAt));
  for (const b of applied) {
    const from = Number(b.beforeCpm ?? b.fromCpm ?? 0), to = Number(b.afterCpm ?? b.toCpm);
    if (!b.appliedAt || !from) continue;
    const seriesKey = `${b.campaignId}|${b.keyword.toLowerCase()}|${b.matchType.toUpperCase()}`, date = iso(new Date(b.appliedAt.getTime() + DAY)); // takes effect from the next full day
    mark(seriesKey, date);
    events.push({ key: `bidchange:${b.id}`, seriesKey, date, changePct: ((to - from) / from) * 100, campaignId: b.campaignId, keyword: b.keyword, matchType: b.matchType });
  }
  const nearKnown = (seriesKey: string, date: string) => (known.get(seriesKey) ?? []).some((k) => Math.abs(new Date(`${k}T00:00:00Z`).getTime() - new Date(`${date}T00:00:00Z`).getTime()) <= 3 * DAY);
  for (const [seriesKey, s] of series) {
    for (const cp of detectCpmChangePoints(s)) {
      if (nearKnown(seriesKey, cp.date)) continue;
      const [campaignId, keyword, matchType] = seriesKey.split("|");
      events.push({ key: `cpm:${seriesKey}:${cp.date}`, seriesKey, date: cp.date, changePct: cp.changePct, campaignId, keyword, matchType: matchType || null });
    }
  }

  const existing = new Set((await prisma.growthActionOutcome.findMany({ where: { brandId, source: "HISTORICAL" }, select: { eventKey: true } })).map((r) => r.eventKey));
  const pending = events.filter((e) => !existing.has(e.key));
  const prefixes = new Map([...series].map(([k, s]) => [k, prefix(s)]));
  const eventDates = new Map<string, string[]>();
  for (const e of events) eventDates.set(e.seriesKey, [...(eventDates.get(e.seriesKey) ?? []), e.date]);
  for (const [k, dates] of known) eventDates.set(k, [...(eventDates.get(k) ?? []), ...dates]);

  const data = [];
  for (const e of pending) {
    const s = series.get(e.seriesKey); if (!s) continue;
    const bFrom = addDays(e.date, -EVENT_WINDOW_DAYS), bTo = addDays(e.date, -1), aTo = addDays(e.date, EVENT_WINDOW_DAYS - 1);
    // Control: keywords with no change anywhere in the 28-day event window.
    let cBefore = 0, cAfter = 0;
    for (const [k, p] of prefixes) {
      if (k === e.seriesKey || (eventDates.get(k) ?? []).some((d) => d >= bFrom && d <= aTo)) continue;
      cBefore += prefixSum(p, bFrom, bTo); cAfter += prefixSum(p, e.date, aTo);
    }
    const r = evaluateBidEvent({ series: s, control: { before: cBefore, after: cAfter }, date: e.date, changePct: e.changePct, lastDate });
    if (!r) continue;
    data.push({ orgId, brandId, planId: null, actionKey: e.key, source: "HISTORICAL", eventKey: e.key, type: "BID", direction: r.direction, campaignId: e.campaignId, keyword: e.keyword, matchType: e.matchType, changePct: e.changePct,
      forecastLow: r.forecast.low, forecastHigh: r.forecast.high, beforeSales: r.before.sales, beforeSpend: r.before.spend, afterSales: r.after.sales, afterSpend: r.after.spend, controlGrowthPct: r.controlGrowthPct,
      salesDelta: r.salesDelta, forecastRatio: r.forecastRatio, measuredFrom: new Date(`${r.measuredFrom}T00:00:00Z`), measuredTo: new Date(`${r.measuredTo}T00:00:00Z`) });
  }

  // Campaign launches: replay the planner's projection on the closest earlier campaign of the same type.
  const campaigns = await prisma.adCampaign.findMany({ where: { brandId, platformId: ads.id, startAt: { gte: since } }, select: { campaignId: true, campaignType: true, startAt: true } });
  const planLaunches = new Set((await prisma.salesGrowthAction.findMany({ where: { brandId, type: "CAMPAIGN", remoteCampaignId: { not: null } }, select: { remoteCampaignId: true } })).map((a) => a.remoteCampaignId));
  const allCampaigns = await prisma.adCampaign.findMany({ where: { brandId, platformId: ads.id }, select: { campaignId: true, campaignType: true } });
  for (const c of campaigns) {
    const key = `launch:${c.campaignId}`;
    if (!c.startAt || existing.has(key) || planLaunches.has(c.campaignId)) continue;
    const start = iso(c.startAt), end = addDays(start, EVENT_WINDOW_DAYS - 1);
    const firstDays = await prisma.adCampaignDaily.findMany({ where: { brandId, campaignId: c.campaignId, date: { gte: c.startAt, lte: new Date(`${end}T00:00:00Z`) } }, select: { spend: true, totalSales: true } });
    const actualSpend = firstDays.reduce((a, d) => a + Number(d.spend), 0), actualSales = firstDays.reduce((a, d) => a + Number(d.totalSales), 0);
    if (firstDays.length < 7 || actualSpend < MIN_WINDOW_SPEND) continue;
    const peers = allCampaigns.filter((p) => p.campaignType === c.campaignType && p.campaignId !== c.campaignId).map((p) => p.campaignId);
    if (!peers.length) continue;
    const refFrom = new Date(c.startAt.getTime() - 30 * DAY), refTo = new Date(c.startAt.getTime() - DAY);
    const refRows = await prisma.adCampaignDaily.findMany({ where: { brandId, campaignId: { in: peers }, date: { gte: refFrom, lte: refTo } }, select: { campaignId: true, spend: true, totalSales: true } });
    const byPeer = new Map<string, { spend: number; sales: number }[]>();
    for (const r of refRows) (byPeer.get(r.campaignId) ?? byPeer.set(r.campaignId, []).get(r.campaignId)!).push({ spend: Number(r.spend), sales: Number(r.totalSales) });
    const best = [...byPeer.values()].filter((d) => d.filter((x) => x.spend > 0).length >= 7).sort((a, b) => b.reduce((s, x) => s + x.spend, 0) - a.reduce((s, x) => s + x.spend, 0))[0];
    if (!best) continue;
    const forecast = campaignLaunchForecast(best, actualSpend);
    data.push({ orgId, brandId, planId: null, actionKey: key, source: "HISTORICAL", eventKey: key, type: "CAMPAIGN", direction: "launch", campaignId: c.campaignId, keyword: null, matchType: null, changePct: null,
      forecastLow: forecast.low, forecastHigh: forecast.high, beforeSales: 0, beforeSpend: 0, afterSales: actualSales, afterSpend: actualSpend, controlGrowthPct: null,
      salesDelta: actualSales, forecastRatio: forecastRatio("launch", actualSales, forecast), measuredFrom: c.startAt, measuredTo: new Date(`${end}T00:00:00Z`) });
  }

  if (data.length) await prisma.growthActionOutcome.createMany({ data, skipDuplicates: true });
  await refreshCalibration(orgId, brandId);
  const result = { bidEvents: data.filter((d) => d.type === "BID").length, campaignEvents: data.filter((d) => d.type === "CAMPAIGN").length, scannedKeywords: series.size };
  logger.info("growth.history_learned", { brandId: brandId.toString(), ...result });
  return result;
}

/** Queues a learning run for a brand (deduped per hour); in-process without Redis. */
export async function scheduleHistoryLearning(orgId: bigint, brandId: bigint, jobSuffix = new Date().toISOString().slice(0, 13)) {
  const { queuesEnabled } = await import("@/lib/queue/connection");
  if (queuesEnabled()) {
    const { growthQueue } = await import("@/lib/queue/queues");
    await growthQueue().add("growth-learn", { learnOrgId: orgId.toString(), learnBrandId: brandId.toString() }, { jobId: `growth-learn-${brandId}-${jobSuffix}`, attempts: 2 });
    return;
  }
  setImmediate(() => { import("./market-learning").then((m) => m.computeMarketInsights(orgId, brandId)).then(() => learnFromHistory(orgId, brandId)).catch((error) => logger.error("growth.history_learn_failed", { brandId: brandId.toString(), error })); });
}
