// Pure, deterministic rules for the sales-growth lifecycle. No I/O: every function here is
// unit-tested and shared by the API routes, the worker and the UI.

export const PLAN_EVIDENCE_MAX_AGE_DAYS = 3;
export const RESEARCH_STALE_MINUTES = 30;
export const REMEASURE_EVERY_HOURS = 6;
export const MAX_RESEARCH_ATTEMPTS = 3;

export type PlanStatus = "QUEUED" | "RESEARCHING" | "WAITING_FOR_DATA" | "FAILED" | "DRAFT" | "APPROVED" | "REJECTED" | "EXPIRED" | "SUPERSEDED" | "MATERIALIZED" | "COMPLETED";
export type ActionStatus = "PROPOSED" | "APPROVED" | "REJECTED" | "BLOCKED" | "DRAFTED" | "LIVE" | "FAILED" | "DISCARDED";

/** Plans that hold the brand's single research / decision slot. */
export const OPEN_PLAN_STATUSES: PlanStatus[] = ["QUEUED", "RESEARCHING", "WAITING_FOR_DATA", "DRAFT", "APPROVED"];
/** Stuck-job recovery watches these; WAITING_FOR_DATA has its own timeout. */
export const RUNNING_PLAN_STATUSES: PlanStatus[] = ["QUEUED", "RESEARCHING"];
/** A brand may have only one plan in research (including waiting for web data). */
export const ACTIVE_RESEARCH_STATUSES: PlanStatus[] = ["QUEUED", "RESEARCHING", "WAITING_FOR_DATA"];

const DAY = 86_400_000;
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** Evidence age in whole days, measured from the last synced ads day. */
export function evidenceAgeDays(dataAsOf: Date, now: Date) {
  return Math.max(0, Math.floor((utcDay(now) - utcDay(dataAsOf)) / DAY));
}

export function evidenceStale(dataAsOf: Date | null | undefined, now: Date) {
  return !dataAsOf || evidenceAgeDays(dataAsOf, now) > PLAN_EVIDENCE_MAX_AGE_DAYS;
}

/** Whether autopilot should research a new plan for this goal now. */
export function autopilotDue(input: { autopilot: boolean; replanEveryDays: number; openPlans: number; runningMeasurement: boolean; lastPlanAt: Date | null; now: Date }) {
  if (!input.autopilot || input.openPlans > 0 || input.runningMeasurement) return false;
  if (!input.lastPlanAt) return true;
  return input.now.getTime() - input.lastPlanAt.getTime() >= Math.max(1, input.replanEveryDays) * DAY;
}

/** Maps the approval queues' states onto the growth action record. */
export function actionStatusFromBid(status: string): ActionStatus {
  if (status === "APPLIED") return "LIVE";
  if (status === "FAILED" || status === "CONFLICT") return "FAILED";
  if (status === "REJECTED" || status === "CANCELLED") return "DISCARDED";
  return "DRAFTED";
}

export function actionStatusFromCampaignChange(status: string): ActionStatus {
  if (status === "APPLIED") return "LIVE";
  if (status === "FAILED") return "FAILED";
  if (status === "REJECTED") return "DISCARDED";
  return "DRAFTED";
}

export function actionStatusFromProposal(status: string): ActionStatus {
  if (status === "APPLIED") return "LIVE";
  if (status === "FAILED" || status === "RECONCILE_REQUIRED") return "FAILED";
  if (status === "REJECTED") return "DISCARDED";
  return "DRAFTED";
}

/**
 * Greedy budget allocation at draft time. Campaign actions are admitted in priority
 * order while today's active budgets plus admitted budgets stay within the ceiling.
 */
export function allocateCampaignBudget<T extends { budget: number }>(rows: T[], currentDailyBudget: number, maxDailyAdSpend: number) {
  let remaining = Math.max(0, maxDailyAdSpend - currentDailyBudget);
  const admitted: T[] = [], blocked: T[] = [];
  for (const row of rows) {
    if (row.budget > 0 && row.budget <= remaining) { admitted.push(row); remaining -= row.budget; } else blocked.push(row);
  }
  return { admitted, blocked, remaining };
}

export interface CampaignPeriod { campaignId: string; sales: number; spend: number }

/**
 * Plan outcome. The comparable baseline is the pre-plan daily run-rate scaled to the
 * elapsed days. Campaigns the plan touched (treated) are compared against the rest
 * (control); lift = treated growth − control growth, a difference-in-differences
 * estimate that strips out market-wide movement such as seasonality.
 */
export function computeOutcome(input: {
  baseline: CampaignPeriod[]; baselineDays: number;
  current: CampaignPeriod[]; elapsedDays: number; horizonDays: number;
  treatedCampaignIds: string[];
  forecast: { targetSales: number; projectedAttributedSalesLow: number; projectedAttributedSalesHigh: number };
}) {
  const treated = new Set(input.treatedCampaignIds);
  const scale = input.elapsedDays / Math.max(1, input.baselineDays);
  const sum = (rows: CampaignPeriod[], pick: (r: CampaignPeriod) => boolean, key: "sales" | "spend") => rows.filter(pick).reduce((a, r) => a + r[key], 0);
  const all = () => true, isTreated = (r: CampaignPeriod) => treated.has(r.campaignId), isControl = (r: CampaignPeriod) => !treated.has(r.campaignId);
  const pct = (now: number, before: number) => (before > 0 ? ((now - before) / before) * 100 : null);

  const sales = sum(input.current, all, "sales"), spend = sum(input.current, all, "spend");
  const baseSales = sum(input.baseline, all, "sales") * scale, baseSpend = sum(input.baseline, all, "spend") * scale;
  const treatedSales = sum(input.current, isTreated, "sales"), treatedBase = sum(input.baseline, isTreated, "sales") * scale;
  const controlSales = sum(input.current, isControl, "sales"), controlBase = sum(input.baseline, isControl, "sales") * scale;
  const treatedGrowthPct = pct(treatedSales, treatedBase), controlGrowthPct = pct(controlSales, controlBase);
  // New campaigns have no pre-plan baseline; all their sales count as incremental.
  const newCampaignSales = sum(input.current, (r) => isTreated(r) && !input.baseline.some((b) => b.campaignId === r.campaignId), "sales");

  const horizonFraction = Math.min(1, input.elapsedDays / Math.max(1, input.horizonDays));
  const runRateProjection = input.elapsedDays > 0 ? (sales / input.elapsedDays) * input.horizonDays : 0;
  const forecastLowToDate = input.forecast.projectedAttributedSalesLow * horizonFraction;
  const forecastHighToDate = input.forecast.projectedAttributedSalesHigh * horizonFraction;

  return {
    measurementStatus: input.elapsedDays >= input.horizonDays ? "COMPLETE" as const : "IN_PROGRESS" as const,
    elapsedDays: input.elapsedDays, horizonDays: input.horizonDays,
    attributedSales: sales, spend, roas: spend ? sales / spend : null,
    comparableBaselineSales: baseSales, comparableBaselineSpend: baseSpend,
    salesChangePct: pct(sales, baseSales), spendChangePct: pct(spend, baseSpend),
    treatedCampaigns: treated.size, treatedSales, treatedGrowthPct, controlSales, controlGrowthPct,
    estimatedLiftPct: treatedGrowthPct != null && controlGrowthPct != null ? treatedGrowthPct - controlGrowthPct : null,
    newCampaignSales,
    forecastLowToDate, forecastHighToDate,
    forecastVerdict: sales < forecastLowToDate ? "BELOW_FORECAST" as const : sales > forecastHighToDate ? "ABOVE_FORECAST" as const : "WITHIN_FORECAST" as const,
    runRateProjection,
    targetSales: input.forecast.targetSales,
    onTrackForTarget: runRateProjection >= input.forecast.targetSales,
  };
}

export type GrowthOutcome = ReturnType<typeof computeOutcome>;
