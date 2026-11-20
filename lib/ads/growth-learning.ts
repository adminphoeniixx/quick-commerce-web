// Sales-growth learning (phase 1): record what LIVE actions achieved, learn a shrunk forecast
// correction per brand × action type × direction, and surface past outcomes to the agents.
// Learning changes forecasts and evidence only — never a bid amount or a safety gate.
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export const CALIBRATION_PRIOR_WEIGHT = 5;
export const CALIBRATION_MIN = 0.25, CALIBRATION_MAX = 1.5;
const RATIO_CLIP = 3, HISTORY_LIMIT = 3;

export type Direction = "increase" | "decrease" | "launch" | "budget_up" | "restart" | "stop";
export interface PastOutcome { planId: string | null; source: string; when: string; direction: Direction; changePct: number | null; salesDelta: number; forecastHigh: number; beforeRoas: number | null; afterRoas: number | null }

// ───────────────────────────── pure math (unit-tested) ─────────────────────────────

/** Lift-adjusted delta: the "before" run-rate is scaled to the measured days and grown by the control group's growth. */
export function liftAdjustedDelta(input: { beforeSales: number; beforeDays: number; afterSales: number; afterDays: number; controlGrowthPct: number | null }) {
  const expected = (input.beforeSales / Math.max(1, input.beforeDays)) * input.afterDays * (1 + (input.controlGrowthPct ?? 0) / 100);
  return input.afterSales - expected;
}

/** Actual ÷ forecast. Reference: the high bound for increase / launch, the (negative) low bound for decrease. */
export function forecastRatio(direction: Direction, salesDelta: number, forecast: { low: number; high: number }) {
  const reference = direction === "decrease" || direction === "stop" ? forecast.low : forecast.high;
  if (Math.abs(reference) < 1) return null;
  return Math.max(-RATIO_CLIP, Math.min(RATIO_CLIP, salesDelta / reference));
}

export function median(values: number[]) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b), mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Weighted median: the smallest value at which cumulative weight reaches half; ties at exactly half average with the next value. */
export function weightedMedian(items: { value: number; weight: number }[]) {
  const s = items.filter((i) => i.weight > 0).sort((a, b) => a.value - b.value);
  if (!s.length) return null;
  const total = s.reduce((a, i) => a + i.weight, 0);
  let acc = 0;
  for (let k = 0; k < s.length; k++) {
    acc += s[k].weight;
    if (Math.abs(acc - total / 2) < 1e-9 && k + 1 < s.length) return (s[k].value + s[k + 1].value) / 2;
    if (acc > total / 2) return s[k].value;
  }
  return s[s.length - 1].value;
}

/** Historical (observational) outcomes count half as much as outcomes of approved plans. */
export const SOURCE_WEIGHT: Record<string, number> = { PLAN: 1, HISTORICAL: 0.5 };

/**
 * Shrinks the observed (weighted) median ratio toward 1 (no correction) and clamps it.
 * The effective sample size is the summed weight, so few or noisy samples keep the factor ≈ 1.
 */
export function calibrationFactor(ratios: (number | { value: number; weight: number })[]) {
  const items = ratios.map((r) => (typeof r === "number" ? { value: r, weight: 1 } : r));
  const m = weightedMedian(items);
  if (m == null) return { sampleSize: 0, rawRatio: 1, factor: 1 };
  const n = items.reduce((a, i) => a + i.weight, 0), shrunk = (n * m + CALIBRATION_PRIOR_WEIGHT * 1) / (n + CALIBRATION_PRIOR_WEIGHT);
  return { sampleSize: items.length, rawRatio: m, factor: Math.max(CALIBRATION_MIN, Math.min(CALIBRATION_MAX, shrunk)) };
}

export function applyFactor(range: { low: number; high: number }, factor: number) {
  return { low: range.low * factor, high: range.high * factor };
}

// ───────────────────────────── recording ─────────────────────────────

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const days = (from: string, to: string) => Math.max(1, Math.round((day(to).getTime() - day(from).getTime()) / 86_400_000) + 1);

async function keywordPeriod(brandId: bigint, campaignId: string, keyword: string, matchType: string | null, from: string, to: string) {
  const [row] = await prisma.$queryRaw<{ sales: unknown; spend: unknown }[]>`
    SELECT COALESCE(SUM("directSales" + "indirectSales"), 0) AS sales, COALESCE(SUM(spend), 0) AS spend FROM "AdKeywordDaily"
    WHERE "brandId" = ${brandId} AND "campaignId" = ${campaignId} AND LOWER(label) = LOWER(${keyword})
      AND (${matchType}::text IS NULL OR UPPER(COALESCE("matchType", '')) = UPPER(${matchType}::text))
      AND date BETWEEN ${day(from)} AND ${day(to)}`;
  return { sales: Number(row?.sales ?? 0), spend: Number(row?.spend ?? 0) };
}

async function campaignPeriod(brandId: bigint, campaignId: string, from: string, to: string) {
  const agg = await prisma.adCampaignDaily.aggregate({ where: { brandId, campaignId, date: { gte: day(from), lte: day(to) } }, _sum: { totalSales: true, spend: true } });
  return { sales: Number(agg._sum.totalSales ?? 0), spend: Number(agg._sum.spend ?? 0) };
}

/** Called once a plan is COMPLETED. Idempotent: existing outcomes are left untouched. */
export async function recordPlanOutcomes(planId: bigint) {
  const plan = await prisma.salesGrowthPlan.findUnique({ where: { id: planId }, include: { planActions: { where: { status: "LIVE" } } } });
  if (!plan || plan.status !== "COMPLETED" || !plan.planActions.length) return 0;
  const baseline = plan.baseline as { from: string; to: string } | null, outcome = plan.outcome as { measuredFrom?: string; measuredTo?: string; controlGrowthPct?: number | null } | null;
  if (!baseline?.from || !outcome?.measuredFrom || !outcome.measuredTo) return 0;
  const beforeDays = days(baseline.from, baseline.to), afterDays = days(outcome.measuredFrom, outcome.measuredTo), control = outcome.controlGrowthPct ?? null;
  let recorded = 0;
  for (const action of plan.planActions) {
    try {
      const payload = action.payload as Record<string, any>, forecast = action.forecastSalesDelta as { low: number; high: number };
      let direction: Direction, before = { sales: 0, spend: 0 }, after = { sales: 0, spend: 0 }, salesDelta: number, changePct: number | null = null;
      if (action.type === "BID") {
        if (!action.campaignId || !action.keyword) continue;
        direction = payload.action === "decrease" ? "decrease" : "increase"; changePct = typeof payload.changePct === "number" ? payload.changePct : null;
        [before, after] = await Promise.all([
          keywordPeriod(plan.brandId, action.campaignId, action.keyword, action.matchType, baseline.from, baseline.to),
          keywordPeriod(plan.brandId, action.campaignId, action.keyword, action.matchType, outcome.measuredFrom, outcome.measuredTo),
        ]);
        salesDelta = liftAdjustedDelta({ beforeSales: before.sales, beforeDays, afterSales: after.sales, afterDays, controlGrowthPct: control });
      } else if (action.type === "CAMPAIGN_CHANGE") {
        if (!action.campaignId) continue;
        direction = payload.kind === "update" ? "budget_up" : payload.kind === "restart" ? "restart" : "stop";
        [before, after] = await Promise.all([
          campaignPeriod(plan.brandId, action.campaignId, baseline.from, baseline.to),
          campaignPeriod(plan.brandId, action.campaignId, outcome.measuredFrom, outcome.measuredTo),
        ]);
        salesDelta = liftAdjustedDelta({ beforeSales: before.sales, beforeDays, afterSales: after.sales, afterDays, controlGrowthPct: control });
      } else {
        if (!action.remoteCampaignId) continue;
        direction = "launch";
        after = await campaignPeriod(plan.brandId, action.remoteCampaignId, outcome.measuredFrom, outcome.measuredTo);
        salesDelta = after.sales; // a new campaign has no pre-plan sales
      }
      await prisma.growthActionOutcome.upsert({
        where: { planId_actionKey: { planId, actionKey: action.actionKey } }, update: {},
        create: { orgId: plan.orgId, brandId: plan.brandId, planId, actionKey: action.actionKey, type: action.type === "CAMPAIGN_CHANGE" ? "CAMPAIGN" : action.type, direction, campaignId: action.campaignId, keyword: action.keyword, matchType: action.matchType, changePct,
          forecastLow: forecast.low, forecastHigh: forecast.high, beforeSales: before.sales, beforeSpend: before.spend, afterSales: after.sales, afterSpend: after.spend, controlGrowthPct: control,
          salesDelta, forecastRatio: forecastRatio(direction, salesDelta, forecast), measuredFrom: day(outcome.measuredFrom), measuredTo: day(outcome.measuredTo) },
      });
      recorded++;
    } catch (error) { logger.error("growth.outcome_record_failed", { planId: planId.toString(), action: action.actionKey, error }); }
  }
  await refreshCalibration(plan.orgId, plan.brandId);
  return recorded;
}

export async function refreshCalibration(orgId: bigint, brandId: bigint) {
  const rows = await prisma.growthActionOutcome.findMany({ where: { brandId, forecastRatio: { not: null } }, select: { type: true, direction: true, forecastRatio: true, source: true } });
  const groups = new Map<string, { value: number; weight: number }[]>();
  for (const r of rows) { const k = `${r.type}|${r.direction}`; groups.set(k, [...(groups.get(k) ?? []), { value: r.forecastRatio!, weight: SOURCE_WEIGHT[r.source] ?? 0.5 }]); }
  for (const [k, ratios] of groups) {
    const [type, direction] = k.split("|"), c = calibrationFactor(ratios);
    await prisma.growthCalibration.upsert({ where: { brandId_type_direction: { brandId, type, direction } }, create: { orgId, brandId, type, direction, ...c }, update: c });
  }
}

// ───────────────────────────── reading (planner + UI) ─────────────────────────────

export async function calibrationFor(brandId: bigint) {
  const rows = await prisma.growthCalibration.findMany({ where: { brandId } });
  const map = new Map(rows.map((r) => [`${r.type}|${r.direction}`, r]));
  return (type: "BID" | "CAMPAIGN", direction: Direction) => {
    const r = map.get(`${type}|${direction}`);
    return { factor: r?.factor ?? 1, sampleSize: r?.sampleSize ?? 0, rawRatio: r?.rawRatio ?? null };
  };
}

const toPast = (o: { planId: bigint | null; source: string; measuredTo: Date; direction: string; changePct: number | null; salesDelta: number; forecastHigh: number; beforeSales: number; beforeSpend: number; afterSales: number; afterSpend: number }): PastOutcome => ({
  planId: o.planId?.toString() ?? null, source: o.source, when: iso(o.measuredTo), direction: o.direction as Direction, changePct: o.changePct, salesDelta: Math.round(o.salesDelta), forecastHigh: Math.round(o.forecastHigh),
  beforeRoas: o.beforeSpend ? Math.round((o.beforeSales / o.beforeSpend) * 100) / 100 : null, afterRoas: o.afterSpend ? Math.round((o.afterSales / o.afterSpend) * 100) / 100 : null,
});

/** Last few outcomes per keyword (BID) and per template campaign (CAMPAIGN), keyed for O(1) lookup. */
export async function pastOutcomesFor(brandId: bigint) {
  const rows = await prisma.growthActionOutcome.findMany({ where: { brandId }, orderBy: { measuredTo: "desc" }, take: 500 });
  const bids = new Map<string, PastOutcome[]>(), campaigns = new Map<string, PastOutcome[]>();
  for (const r of rows) {
    const map = r.type === "BID" ? bids : campaigns, key = r.type === "BID" ? `${r.campaignId}|${(r.keyword ?? "").toLowerCase()}` : r.campaignId ?? "";
    const list = map.get(key) ?? [];
    if (list.length < HISTORY_LIMIT) { list.push(toPast(r)); map.set(key, list); }
  }
  return {
    bid: (campaignId: string, keyword: string) => bids.get(`${campaignId}|${keyword.toLowerCase()}`) ?? [],
    campaign: (templateId: string) => campaigns.get(templateId) ?? [],
  };
}

export async function learningSummary(brandId: bigint) {
  const [calibration, recent, bySource] = await Promise.all([
    prisma.growthCalibration.findMany({ where: { brandId }, orderBy: [{ type: "asc" }, { direction: "asc" }] }),
    prisma.growthActionOutcome.findMany({ where: { brandId }, orderBy: { measuredTo: "desc" }, take: 10 }),
    prisma.growthActionOutcome.groupBy({ by: ["source"], where: { brandId }, _count: true }),
  ]);
  const count = (source: string) => bySource.find((r) => r.source === source)?._count ?? 0;
  return {
    totalOutcomes: count("PLAN") + count("HISTORICAL"), planOutcomes: count("PLAN"), historicalOutcomes: count("HISTORICAL"),
    calibration: calibration.map((c) => ({ type: c.type, direction: c.direction, sampleSize: c.sampleSize, rawRatio: c.rawRatio, factor: c.factor, updatedAt: c.updatedAt })),
    recent: recent.map((o) => ({ ...toPast(o), type: o.type, keyword: o.keyword, campaignId: o.campaignId, forecastRatio: o.forecastRatio })),
  };
}
