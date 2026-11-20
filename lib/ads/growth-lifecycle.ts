// Sales-growth lifecycle: async research, human decisions, revalidated drafting, execution
// tracking, measurement and autopilot. Routes and the worker call into this module only.
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { BadRequest, Conflict, NotFound } from "@/lib/http";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import { sendMail } from "@/lib/mailer";
import { ADS_PLATFORM, adsCampaigns, type AdsScope } from "./queries";
import { generateGrowthPlan } from "./growth-planner";
import { recordPlanOutcomes } from "./growth-learning";
import { PLAN_WEB_DATA_MAX_AGE_DAYS, DAILY_WEB_DATA_MAX_AGE_DAYS, WAIT_FOR_DATA_MINUTES, requestAgentSearch, resumeWaitingPlans, webDataGaps } from "./web-research";
import { proposeBids } from "./bids";
import { campaignProposalKey } from "./campaign-proposal-key";
import {
  ACTIVE_RESEARCH_STATUSES, MAX_RESEARCH_ATTEMPTS, OPEN_PLAN_STATUSES, REMEASURE_EVERY_HOURS, RESEARCH_STALE_MINUTES, RUNNING_PLAN_STATUSES,
  actionStatusFromBid, actionStatusFromCampaignChange, actionStatusFromProposal, allocateCampaignBudget, autopilotDue, computeOutcome, evidenceStale,
  type ActionStatus,
} from "./growth-rules";

export const GROWTH_PROMPT_VERSION = "growth-v4";
const iso = (d: Date) => d.toISOString().slice(0, 10);
const appUrl = process.env.APP_URL ?? "http://localhost:3000";

interface Actor { email: string; userId: bigint | null }
interface PlanAction { type: "BID" | "CAMPAIGN"; id: string; priority: number; title: string; campaignId?: string; forecastSalesDelta: { low: number; high: number }; payload: Record<string, any> }

/** AdsScope for background work, where no HTTP request exists. */
export async function scopeFor(orgId: bigint, brandId: bigint): Promise<AdsScope> {
  const rows = await prisma.platform.findMany({ where: { slug: { in: [ADS_PLATFORM, "blinkit"] } }, select: { id: true, slug: true } });
  const ads = rows.find((r) => r.slug === ADS_PLATFORM)?.id;
  if (!ads) throw new Error("Blinkit Ads platform is not set up (run migrations)");
  return { orgId, brandId, platformId: ads, sellerPlatformId: rows.find((r) => r.slug === "blinkit")?.id ?? null, url: new URL(`${appUrl}/internal/growth?brandId=${brandId}`) };
}

async function notify(goalId: bigint, fallback: string, subject: string, body: string) {
  const goal = await prisma.salesGrowthGoal.findUnique({ where: { id: goalId }, select: { notifyEmail: true } });
  const to = goal?.notifyEmail || (fallback.includes("@") ? fallback : null);
  if (!to) return;
  await sendMail(to, subject, `${body}\n\nOpen: ${appUrl}/dashboard/ads/growth`).catch((error) => logger.error("growth.notify_failed", { error }));
}

// ───────────────────────────── research ─────────────────────────────

/**
 * Creates a QUEUED plan and dispatches research. A per-brand advisory lock makes the
 * "one open plan per brand" rule hold under concurrent clicks and autopilot sweeps.
 */
export async function enqueueGrowthPlan(input: { orgId: bigint; brandId: bigint; createdBy: string; userId: bigint | null; trigger: "manual" | "autopilot" }) {
  const plan = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`growth-plan:${input.brandId}`}))`;
    const goal = await tx.salesGrowthGoal.findFirst({ where: { orgId: input.orgId, brandId: input.brandId, active: true }, orderBy: { createdAt: "desc" } });
    if (!goal) throw BadRequest("Create a sales-growth goal first");
    const running = await tx.salesGrowthPlan.findFirst({ where: { orgId: input.orgId, brandId: input.brandId, status: { in: ACTIVE_RESEARCH_STATUSES } }, select: { id: true } });
    if (running) throw Conflict(`Plan #${running.id} is already being researched`);
    return tx.salesGrowthPlan.create({ data: { orgId: input.orgId, brandId: input.brandId, goalId: goal.id, status: "QUEUED", trigger: input.trigger, promptVersion: GROWTH_PROMPT_VERSION, createdBy: input.createdBy } });
  });
  await writeAudit({ userId: input.userId, orgId: input.orgId, action: "ads.growth_plan_queued", target: plan.id.toString(), meta: { trigger: input.trigger } });
  await dispatchResearch(plan.id);
  return plan;
}

async function dispatchResearch(planId: bigint, tag = "") {
  const { queuesEnabled } = await import("@/lib/queue/connection");
  if (queuesEnabled()) {
    const { growthQueue } = await import("@/lib/queue/queues");
    await growthQueue().add("growth-plan", { planId: planId.toString() }, { jobId: `growth-plan-${planId}${tag}`, attempts: MAX_RESEARCH_ATTEMPTS, backoff: { type: "exponential", delay: 30_000 } });
    return;
  }
  // No Redis (local dev): research in-process, off the request path.
  setImmediate(() => { runGrowthResearch(planId, true).catch((error) => logger.error("growth.inline_research_failed", { planId: planId.toString(), error })); });
}

/** Sends a waiting / recovered plan back to research. A fresh job id: BullMQ keeps finished job ids. */
export async function requeueResearch(planId: bigint) {
  const moved = await prisma.salesGrowthPlan.updateMany({ where: { id: planId, status: { in: ["WAITING_FOR_DATA", "RESEARCHING", "QUEUED"] } }, data: { status: "QUEUED" } });
  if (moved.count === 1) await dispatchResearch(planId, `-r${Date.now()}`);
}

/** Worker entry. `finalAttempt` decides whether an error fails the plan or leaves it for retry. */
export async function runGrowthResearch(planId: bigint, finalAttempt: boolean) {
  const claimed = await prisma.salesGrowthPlan.updateMany({ where: { id: planId, status: { in: ["QUEUED", "RESEARCHING"] } }, data: { status: "RESEARCHING", startedAt: new Date(), attempts: { increment: 1 }, error: null } });
  if (claimed.count !== 1) return "skipped";
  const plan = await prisma.salesGrowthPlan.findUniqueOrThrow({ where: { id: planId } });
  const goal = await prisma.salesGrowthGoal.findUniqueOrThrow({ where: { id: plan.goalId } });
  try {
    const scope = await scopeFor(plan.orgId, plan.brandId);
    // Self-directed web research: refresh stale blinkit.com search data once per plan, within the shared limits.
    const warnings: string[] = [];
    const gaps = await webDataGaps(plan.brandId, PLAN_WEB_DATA_MAX_AGE_DAYS);
    if (gaps.length) {
      const waited = await prisma.auditLog.findFirst({ where: { action: "growth.plan_waited_for_data", target: planId.toString() }, select: { id: true } });
      if (!waited) {
        const req = await requestAgentSearch({ orgId: plan.orgId, brandId: plan.brandId, keywords: gaps, reason: `growth plan #${planId}`, planId });
        if (req.ok) {
          await prisma.salesGrowthPlan.update({ where: { id: planId }, data: { status: "WAITING_FOR_DATA", error: `Waiting for fresh blinkit.com search data for ${req.keywords.length} keyword(s) at "${req.location}". Research continues automatically within ${WAIT_FOR_DATA_MINUTES} minutes.` } });
          await writeAudit({ orgId: plan.orgId, action: "growth.plan_waited_for_data", target: planId.toString(), meta: { keywords: req.keywords } });
          return "waiting";
        }
        warnings.push(`blinkit.com search data for ${gaps.length} top keyword(s) is older than ${PLAN_WEB_DATA_MAX_AGE_DAYS} days and agents could not refresh it: ${req.reason}.`);
      } else warnings.push(`blinkit.com search data is still missing or stale for ${gaps.length} top keyword(s) after one refresh attempt.`);
    }
    const result = await generateGrowthPlan(scope, { targetSalesGrowthPct: Number(goal.targetSalesGrowthPct), maxDailyAdSpend: Number(goal.maxDailyAdSpend), minimumRoas: Number(goal.minimumRoas), horizonDays: goal.horizonDays });
    result.forecast.warnings.push(...warnings);
    const duplicate = await prisma.salesGrowthPlan.findFirst({ where: { orgId: plan.orgId, payloadHash: result.payloadHash }, select: { id: true } });
    if (duplicate) {
      await prisma.salesGrowthPlan.update({ where: { id: planId }, data: { status: "SUPERSEDED", finishedAt: new Date(), error: `Evidence unchanged since plan #${duplicate.id}; no new research was needed.` } });
      return "duplicate";
    }
    const actions = result.actions as unknown as PlanAction[];
    await prisma.$transaction([
      // A fresh plan replaces older plans still awaiting a decision.
      prisma.salesGrowthPlan.updateMany({ where: { orgId: plan.orgId, brandId: plan.brandId, id: { not: planId }, status: { in: ["DRAFT", "APPROVED"] } }, data: { status: "SUPERSEDED", error: `Superseded by plan #${planId}` } }),
      prisma.salesGrowthPlan.update({ where: { id: planId }, data: { status: "DRAFT", baseline: result.baseline, forecast: result.forecast, actions: result.actions as unknown as Prisma.InputJsonValue, agentReviews: result.agentReviews, dataAsOf: result.dataAsOf, model: result.model, payloadHash: result.payloadHash, finishedAt: new Date() } }),
      prisma.salesGrowthAction.createMany({ data: actions.map((a) => ({
        planId, orgId: plan.orgId, brandId: plan.brandId, actionKey: a.id, type: a.type, priority: a.priority, title: a.title.slice(0, 300),
        campaignId: a.type === "CAMPAIGN" ? a.payload.templateId ?? null : a.campaignId ?? null, keyword: a.payload.keyword ?? null, matchType: a.payload.matchType ?? null,
        payload: a.payload as Prisma.InputJsonValue, forecastSalesDelta: a.forecastSalesDelta,
      })), skipDuplicates: true }),
    ]);
    await writeAudit({ orgId: plan.orgId, action: "ads.growth_plan_generated", target: planId.toString(), meta: { trigger: plan.trigger, actions: actions.length, model: result.model } });
    await notify(plan.goalId, plan.createdBy, `Growth plan #${planId} is ready for review`, `${actions.length} action(s) passed the safety gates. Projected attributed sales: ₹${Math.round(result.forecast.projectedAttributedSalesLow)}–₹${Math.round(result.forecast.projectedAttributedSalesHigh)} vs target ₹${Math.round(result.forecast.targetSales)}.`);
    return "drafted";
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
    // Client errors (no synced data, missing setup) will not fix themselves on retry.
    const status = (error as { status?: number })?.status, permanent = finalAttempt || (status != null && status < 500);
    await prisma.salesGrowthPlan.update({ where: { id: planId }, data: permanent ? { status: "FAILED", error: message, finishedAt: new Date() } : { status: "QUEUED", error: `Retrying: ${message}` } });
    if (!permanent) throw error;
    await writeAudit({ orgId: plan.orgId, action: "ads.growth_plan_failed", target: planId.toString(), meta: { error: message } });
    await notify(plan.goalId, plan.createdBy, `Growth plan #${planId} failed`, `Research failed: ${message}`);
    return "failed";
  }
}

// ───────────────────────────── decisions ─────────────────────────────

async function loadPlan(scope: AdsScope, id: string) {
  if (!/^\d{1,20}$/.test(id)) throw NotFound("Growth plan not found");
  const plan = await prisma.salesGrowthPlan.findFirst({ where: { id: BigInt(id), orgId: scope.orgId, brandId: scope.brandId } });
  if (!plan) throw NotFound("Growth plan not found");
  return plan;
}

async function expireIfStale(plan: { id: bigint; status: string; dataAsOf: Date | null }) {
  if (!["DRAFT", "APPROVED"].includes(plan.status) || !evidenceStale(plan.dataAsOf, new Date())) return false;
  await prisma.salesGrowthPlan.updateMany({ where: { id: plan.id, status: plan.status }, data: { status: "EXPIRED", error: "Evidence is older than 3 days; generate a fresh plan" } });
  return true;
}

/** Approve a subset of actions (the rest are rejected), or reject the whole plan. */
export async function decideGrowthPlan(scope: AdsScope, actor: Actor, id: string, decision: "approve" | "reject", actionIds?: string[]) {
  const plan = await loadPlan(scope, id);
  if (plan.status !== "DRAFT") throw Conflict(`Growth plan is already ${plan.status.toLowerCase()}`);
  if (await expireIfStale(plan)) throw Conflict("Plan evidence is older than 3 days and has expired; generate a fresh plan");
  const actions = await prisma.salesGrowthAction.findMany({ where: { planId: plan.id }, select: { id: true, actionKey: true } });
  const now = new Date();
  if (decision === "reject") {
    await prisma.$transaction([
      prisma.salesGrowthAction.updateMany({ where: { planId: plan.id, status: "PROPOSED" }, data: { status: "REJECTED", decidedBy: actor.email, decidedAt: now } }),
      prisma.salesGrowthPlan.update({ where: { id: plan.id }, data: { status: "REJECTED", approvedBy: actor.email, approvedAt: now } }),
    ]);
    await writeAudit({ userId: actor.userId, orgId: scope.orgId, action: "ads.growth_plan_rejected", target: plan.id.toString() });
    return { id: plan.id.toString(), status: "REJECTED", approved: 0 };
  }
  const selected = new Set(actionIds ?? actions.map((a) => a.actionKey));
  const unknown = [...selected].filter((key) => !actions.some((a) => a.actionKey === key));
  if (unknown.length) throw BadRequest(`Unknown action(s): ${unknown.slice(0, 3).join(", ")}`);
  if (!selected.size) throw BadRequest("Select at least one action to approve, or reject the plan");
  const claimed = await prisma.$transaction(async (tx) => {
    const res = await tx.salesGrowthPlan.updateMany({ where: { id: plan.id, status: "DRAFT" }, data: { status: "APPROVED", approvedBy: actor.email, approvedAt: now } });
    if (res.count !== 1) return false;
    await tx.salesGrowthAction.updateMany({ where: { planId: plan.id, actionKey: { in: [...selected] } }, data: { status: "APPROVED", decidedBy: actor.email, decidedAt: now } });
    await tx.salesGrowthAction.updateMany({ where: { planId: plan.id, actionKey: { notIn: [...selected] } }, data: { status: "REJECTED", decidedBy: actor.email, decidedAt: now } });
    return true;
  });
  if (!claimed) throw Conflict("Growth plan was decided by someone else");
  await writeAudit({ userId: actor.userId, orgId: scope.orgId, action: "ads.growth_plan_approved", target: plan.id.toString(), meta: { approved: [...selected], rejected: actions.length - selected.size } });
  return { id: plan.id.toString(), status: "APPROVED", approved: selected.size };
}

// ───────────────────────────── drafting ─────────────────────────────

/**
 * Turns approved actions into bid changes and campaign proposals in the existing approval
 * queues. Everything is revalidated against today's state; an action that no longer passes
 * is BLOCKED with the reason instead of failing the whole plan.
 */
export async function materializeGrowthPlan(scope: AdsScope, actor: Actor, id: string) {
  const plan = await loadPlan(scope, id);
  if (plan.status === "MATERIALIZED" || plan.status === "COMPLETED") return summary(plan.id);
  if (plan.status !== "APPROVED") throw Conflict("Approve the growth strategy before creating action drafts");
  if (await expireIfStale(plan)) throw Conflict("Plan evidence is older than 3 days and has expired; generate a fresh plan");
  const goal = await prisma.salesGrowthGoal.findFirst({ where: { orgId: scope.orgId, brandId: scope.brandId, active: true }, orderBy: { createdAt: "desc" } });
  if (!goal || goal.id !== plan.goalId) throw Conflict("The sales-growth goal changed after this plan was researched; generate a fresh plan");
  const claimed = await prisma.salesGrowthPlan.updateMany({ where: { id: plan.id, status: "APPROVED" }, data: { status: "MATERIALIZED", materializedAt: new Date() } });
  if (claimed.count !== 1) return summary(plan.id);

  const actions = await prisma.salesGrowthAction.findMany({ where: { planId: plan.id, status: "APPROVED" }, orderBy: [{ priority: "asc" }, { id: "asc" }] });
  const dataAsOf = iso(plan.dataAsOf!);
  const block = (actionId: bigint, error: string) => prisma.salesGrowthAction.update({ where: { id: actionId }, data: { status: "BLOCKED", error: error.slice(0, 1000) } });

  // Bids: one at a time so a single failing bid does not block the rest.
  for (const action of actions.filter((a) => a.type === "BID")) {
    const row = action.payload as Record<string, any>;
    try {
      await proposeBids(scope, actor.email, actor.userId ?? 0n, [{ campaignId: row.campaignId, keyword: row.keyword, matchType: row.matchType, toCpm: row.toCpm, note: `Growth plan #${plan.id} · ${row.objective}: ${row.reason}`.slice(0, 300), evidence: row, dataAsOf, model: plan.model, promptVersion: plan.promptVersion, growthPlanId: plan.id }]);
      const change = await prisma.adBidChange.findFirst({ where: { growthPlanId: plan.id, campaignId: row.campaignId, keyword: { equals: row.keyword, mode: "insensitive" } }, orderBy: { id: "desc" }, select: { id: true } });
      await prisma.salesGrowthAction.update({ where: { id: action.id }, data: { status: "DRAFTED", bidChangeId: change?.id ?? null, error: null } });
    } catch (error) { await block(action.id, error instanceof Error ? error.message : "Bid draft failed"); }
  }

  // Campaign changes (budget up / restart / stop): Blinkit state must still match the research, and
  // added budget must fit the ceiling. Stops free no budget here (conservative).
  const active = await prisma.adCampaign.findMany({ where: { brandId: scope.brandId, platformId: scope.platformId, status: "ACTIVE" }, select: { budget: true } });
  let currentDailyBudget = active.reduce((sum, c) => sum + Number(c.budget ?? 0), 0);
  const changeActions = actions.filter((a) => a.type === "CAMPAIGN_CHANGE");
  if (changeActions.length) {
    const now = await prisma.adCampaign.findMany({ where: { brandId: scope.brandId, platformId: scope.platformId, campaignId: { in: changeActions.map((a) => a.campaignId!).filter(Boolean) } }, select: { campaignId: true, status: true, budget: true } });
    const nowBy = new Map(now.map((c) => [c.campaignId, c]));
    const valid: typeof changeActions = [];
    for (const action of changeActions) {
      const row = action.payload as Record<string, any>, c = nowBy.get(row.campaignId);
      if (!c || c.status !== row.currentStatus || Number(c.budget ?? 0) !== Number(row.currentBudget ?? 0)) { await block(action.id, `Campaign "${row.name}" changed on Blinkit since research (now ${c?.status ?? "missing"}, budget ${c?.budget ?? "—"}); generate a fresh plan`); continue; }
      if (row.agentConsensus?.verdict !== "approve") { await block(action.id, "No valid specialist approval"); continue; }
      valid.push(action);
    }
    const extra = (row: Record<string, any>) => row.kind === "update" ? Number(row.toBudget) - Number(row.currentBudget) : row.kind === "restart" ? Number(row.toBudget) : 0;
    const spending = valid.filter((a) => extra(a.payload as any) > 0), free = valid.filter((a) => extra(a.payload as any) <= 0);
    const { admitted, blocked } = allocateCampaignBudget(spending.map((a) => ({ action: a, budget: extra(a.payload as any) })), currentDailyBudget, Number(goal.maxDailyAdSpend));
    for (const { action } of blocked) await block(action.id, `Would exceed the ₹${Math.round(Number(goal.maxDailyAdSpend))}/day ceiling (active budgets now ₹${Math.round(currentDailyBudget)}/day)`);
    currentDailyBudget += admitted.reduce((sum, a) => sum + a.budget, 0);
    for (const action of [...free, ...admitted.map((a) => a.action)]) {
      const row = action.payload as Record<string, any>;
      try {
        await prisma.adCampaignChange.create({ data: { orgId: scope.orgId, brandId: scope.brandId, platformId: scope.platformId, campaignId: row.campaignId, campaignName: row.name, kind: row.kind, expectedStatus: row.currentStatus, expectedBudget: row.currentBudget, toBudget: row.toBudget, reason: `Growth plan #${plan.id}: ${row.reason}`.slice(0, 1000), evidence: row, growthPlanId: plan.id, createdBy: actor.email } });
        await prisma.salesGrowthAction.update({ where: { id: action.id }, data: { status: "DRAFTED", error: null } });
      } catch (error) { await block(action.id, error instanceof Error ? error.message : "Campaign change draft failed"); }
    }
  }

  // Campaign launches: re-check the daily spend ceiling against today's active budgets plus admitted changes.
  const campaignActions = actions.filter((a) => a.type === "CAMPAIGN");
  if (campaignActions.length) {
    const { admitted, blocked } = allocateCampaignBudget(campaignActions.map((a) => ({ action: a, budget: Number((a.payload as any).budget ?? 0) })), currentDailyBudget, Number(goal.maxDailyAdSpend));
    for (const { action } of blocked) await block(action.id, `Would exceed the ₹${Math.round(Number(goal.maxDailyAdSpend))}/day ceiling (active budgets now ₹${Math.round(currentDailyBudget)}/day)`);
    for (const { action } of admitted) {
      const row = action.payload as Record<string, any>;
      if (!row.launchReady || row.agentConsensus?.verdict !== "launch") { await block(action.id, "No valid specialist launch approval"); continue; }
      try {
        const payloadHash = createHash("sha256").update(JSON.stringify(row)).digest("hex");
        const idempotencyKey = campaignProposalKey({ brandId: scope.brandId, platformId: scope.platformId, templateId: row.templateId, start: row.start, end: row.end, budget: row.budget, dataAsOf, promptVersion: plan.promptVersion });
        const proposal = await prisma.adCampaignProposal.upsert({ where: { orgId_idempotencyKey: { orgId: scope.orgId, idempotencyKey } }, create: { orgId: scope.orgId, brandId: scope.brandId, platformId: scope.platformId, templateCampaignId: row.templateId, name: row.name, budget: row.budget, startAt: new Date(`${row.start}T00:00:00Z`), endAt: new Date(`${row.end}T00:00:00Z`), evidence: { launchReady: row.launchReady, confidence: row.confidence, historicalSpend: row.historicalSpend, historicalSales: row.historicalSales, historicalRoas: row.historicalRoas }, forecast: { maximumSpend: row.maximumSpend, projectedSales: row.projectedSales, projectedRoas: row.projectedRoas, assumptions: row.assumptions, risks: row.risks }, agentReviews: row.agentConsensus, dataAsOf: plan.dataAsOf!, model: plan.model, promptVersion: plan.promptVersion, idempotencyKey, payloadHash, createdBy: actor.email, growthPlanId: plan.id }, update: { growthPlanId: plan.id } });
        await prisma.salesGrowthAction.update({ where: { id: action.id }, data: { status: actionStatusFromProposal(proposal.status), campaignProposalId: proposal.id, remoteCampaignId: proposal.remoteCampaignId, error: null } });
      } catch (error) { await block(action.id, error instanceof Error ? error.message : "Campaign draft failed"); }
    }
  }
  const result = await summary(plan.id);
  await writeAudit({ userId: actor.userId, orgId: scope.orgId, action: "ads.growth_plan_materialized", target: plan.id.toString(), meta: result });
  return result;
}

async function summary(planId: bigint) {
  const rows = await prisma.salesGrowthAction.groupBy({ by: ["status"], where: { planId }, _count: true });
  return { status: "MATERIALIZED", actions: Object.fromEntries(rows.map((r) => [r.status, r._count])) as Partial<Record<ActionStatus, number>> };
}

// ───────────────────────────── tracking & measurement ─────────────────────────────

/** Pulls execution state from the bid / campaign approval queues onto the action records. */
export async function syncPlanActions(planId: bigint) {
  const actions = await prisma.salesGrowthAction.findMany({ where: { planId, status: { in: ["DRAFTED", "LIVE", "FAILED"] } } });
  if (!actions.length) return;
  const changeRows = actions.some((a) => a.type === "CAMPAIGN_CHANGE") ? await prisma.adCampaignChange.findMany({ where: { growthPlanId: planId }, select: { campaignId: true, kind: true, status: true, error: true } }) : [];
  for (const action of actions.filter((a) => a.type === "CAMPAIGN_CHANGE")) {
    const kind = (action.payload as any)?.kind, change = changeRows.find((c) => c.campaignId === action.campaignId && c.kind === kind);
    const status = change ? actionStatusFromCampaignChange(change.status) : action.status;
    if (change && status !== action.status) await prisma.salesGrowthAction.update({ where: { id: action.id }, data: { status, error: change.error } });
  }
  const bidIds = actions.map((a) => a.bidChangeId).filter((x): x is bigint => x != null), proposalIds = actions.map((a) => a.campaignProposalId).filter((x): x is bigint => x != null);
  const [bids, proposals] = await Promise.all([
    bidIds.length ? prisma.adBidChange.findMany({ where: { id: { in: bidIds } }, select: { id: true, status: true, error: true } }) : [],
    proposalIds.length ? prisma.adCampaignProposal.findMany({ where: { id: { in: proposalIds } }, select: { id: true, status: true, error: true, remoteCampaignId: true } }) : [],
  ]);
  const bidBy = new Map(bids.map((b) => [b.id, b])), propBy = new Map(proposals.map((p) => [p.id, p]));
  for (const action of actions) {
    const bid = action.bidChangeId != null ? bidBy.get(action.bidChangeId) : undefined, prop = action.campaignProposalId != null ? propBy.get(action.campaignProposalId) : undefined;
    const next = bid ? { status: actionStatusFromBid(bid.status), error: bid.error, remoteCampaignId: action.remoteCampaignId } : prop ? { status: actionStatusFromProposal(prop.status), error: prop.error, remoteCampaignId: prop.remoteCampaignId } : null;
    if (next && (next.status !== action.status || next.remoteCampaignId !== action.remoteCampaignId)) await prisma.salesGrowthAction.update({ where: { id: action.id }, data: next });
  }
}

/** Measures a MATERIALIZED plan; completes it once the horizon has elapsed. */
export async function measureGrowthPlan(planId: bigint, actor: Actor | null) {
  const plan = await prisma.salesGrowthPlan.findUnique({ where: { id: planId } });
  if (!plan) throw NotFound("Growth plan not found");
  if (!["MATERIALIZED", "COMPLETED"].includes(plan.status) || !plan.materializedAt) throw Conflict("Create approval drafts before measuring this plan");
  await syncPlanActions(planId);
  const goal = await prisma.salesGrowthGoal.findUnique({ where: { id: plan.goalId } });
  const horizonDays = goal?.horizonDays ?? (plan.baseline as any)?.horizonDays ?? 30;
  const scope = await scopeFor(plan.orgId, plan.brandId);
  const baseline = plan.baseline as { from: string; to: string; observedDays: number };
  const forecast = plan.forecast as { targetSales: number; projectedAttributedSalesLow: number; projectedAttributedSalesHigh: number };
  const from = new Date(plan.materializedAt); from.setUTCHours(0, 0, 0, 0);
  const end = new Date(from); end.setUTCDate(end.getUTCDate() + horizonDays - 1);
  const to = new Date(Math.min(Date.now(), end.getTime())); to.setUTCHours(0, 0, 0, 0);
  const elapsedDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1);
  const live = await prisma.salesGrowthAction.findMany({ where: { planId, status: "LIVE" }, select: { type: true, campaignId: true, remoteCampaignId: true } });
  const treated = [...new Set(live.map((a) => (a.type === "CAMPAIGN" ? a.remoteCampaignId : a.campaignId)).filter((x): x is string => !!x))];
  const [before, after] = await Promise.all([
    adsCampaigns(scope, { from: new Date(`${baseline.from}T00:00:00Z`), to: new Date(`${baseline.to}T00:00:00Z`) }),
    adsCampaigns(scope, { from, to }),
  ]);
  const toPeriod = (rows: typeof before) => rows.map((r) => ({ campaignId: r.campaignId, sales: r.period.sales, spend: r.period.spend }));
  const outcome = { ...computeOutcome({ baseline: toPeriod(before), baselineDays: baseline.observedDays, current: toPeriod(after), elapsedDays, horizonDays, treatedCampaignIds: treated, forecast }), measuredFrom: iso(from), measuredTo: iso(to), expectedCompleteAt: iso(end) };
  const completing = outcome.measurementStatus === "COMPLETE" && plan.status !== "COMPLETED";
  await prisma.salesGrowthPlan.update({ where: { id: planId }, data: { measuredAt: new Date(), outcome, ...(completing ? { status: "COMPLETED", completedAt: new Date() } : {}) } });
  await writeAudit({ userId: actor?.userId ?? null, orgId: plan.orgId, action: completing ? "ads.growth_plan_completed" : "ads.growth_plan_measured", target: planId.toString(), meta: outcome });
  if (completing) await recordPlanOutcomes(planId).catch((error) => logger.error("growth.learning_failed", { planId: planId.toString(), error }));
  if (completing) await notify(plan.goalId, plan.createdBy, `Growth plan #${planId} completed`, `Attributed sales ₹${Math.round(outcome.attributedSales)} vs target ₹${Math.round(forecast.targetSales * Math.min(1, elapsedDays / horizonDays))}. Sales change ${outcome.salesChangePct?.toFixed(1) ?? "—"}%, estimated lift ${outcome.estimatedLiftPct?.toFixed(1) ?? "—"} pts.`);
  return outcome;
}

export async function measureGrowthPlanFor(scope: AdsScope, actor: Actor, id: string) {
  const plan = await loadPlan(scope, id);
  return measureGrowthPlan(plan.id, actor);
}

// ───────────────────────────── autopilot sweep ─────────────────────────────

/** Hourly worker sweep: recover stuck research, expire stale plans, measure, autopilot re-plan. */
export async function runGrowthSweep(now = new Date()) {
  const stats = { recovered: 0, expired: 0, measured: 0, autopilot: 0, learning: 0, webScrapes: 0, errors: 0 };
  const stuck = await prisma.salesGrowthPlan.findMany({ where: { status: { in: RUNNING_PLAN_STATUSES }, updatedAt: { lt: new Date(now.getTime() - RESEARCH_STALE_MINUTES * 60_000) } }, select: { id: true, attempts: true } });
  for (const p of stuck) {
    if (p.attempts >= MAX_RESEARCH_ATTEMPTS) await prisma.salesGrowthPlan.update({ where: { id: p.id }, data: { status: "FAILED", error: "Research did not finish; the worker may have restarted", finishedAt: now } });
    else await requeueResearch(p.id);
    stats.recovered++;
  }
  stats.recovered += await resumeWaitingPlans({ waitedLongerThanMinutes: WAIT_FOR_DATA_MINUTES });
  const decidable = await prisma.salesGrowthPlan.findMany({ where: { status: { in: ["DRAFT", "APPROVED"] } }, select: { id: true, status: true, dataAsOf: true } });
  for (const p of decidable) if (await expireIfStale(p)) stats.expired++;

  const toMeasure = await prisma.salesGrowthPlan.findMany({ where: { status: "MATERIALIZED", OR: [{ measuredAt: null }, { measuredAt: { lt: new Date(now.getTime() - REMEASURE_EVERY_HOURS * 3_600_000) } }] }, select: { id: true } });
  for (const p of toMeasure) {
    try { await measureGrowthPlan(p.id, null); stats.measured++; } catch (error) { stats.errors++; logger.error("growth.sweep_measure_failed", { planId: p.id.toString(), error }); }
  }

  const goals = await prisma.salesGrowthGoal.findMany({ where: { active: true, autopilot: true } });
  for (const goal of goals) {
    const [openPlans, measuring, last] = await Promise.all([
      prisma.salesGrowthPlan.count({ where: { brandId: goal.brandId, status: { in: OPEN_PLAN_STATUSES } } }),
      prisma.salesGrowthPlan.count({ where: { brandId: goal.brandId, status: "MATERIALIZED" } }),
      prisma.salesGrowthPlan.findFirst({ where: { brandId: goal.brandId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    ]);
    if (!autopilotDue({ autopilot: goal.autopilot, replanEveryDays: goal.replanEveryDays, openPlans, runningMeasurement: measuring > 0, lastPlanAt: last?.createdAt ?? null, now })) continue;
    try { await enqueueGrowthPlan({ orgId: goal.orgId, brandId: goal.brandId, createdBy: "autopilot", userId: null, trigger: "autopilot" }); stats.autopilot++; }
    catch (error) { stats.errors++; logger.error("growth.autopilot_failed", { goalId: goal.id.toString(), error }); }
  }
  // Daily history-learning backfill for every brand with synced Ads data (deduped per day by job id).
  const { scheduleHistoryLearning } = await import("./growth-history");
  const brands = await prisma.adCampaignDaily.groupBy({ by: ["orgId", "brandId"], where: { date: { gte: new Date(now.getTime() - 30 * 86_400_000) } } });
  for (const b of brands) {
    try {
      await scheduleHistoryLearning(b.orgId, b.brandId, now.toISOString().slice(0, 10)); stats.learning++;
      // Daily learning scrape: keep web history growing for the keywords with the oldest data (1 agent run a day at most).
      const gaps = await webDataGaps(b.brandId, DAILY_WEB_DATA_MAX_AGE_DAYS, now, 30);
      if (gaps.length) { const r = await requestAgentSearch({ orgId: b.orgId, brandId: b.brandId, keywords: gaps, reason: "daily learning" }); if (r.ok) stats.webScrapes++; }
    }
    catch (error) { stats.errors++; logger.error("growth.history_schedule_failed", { brandId: b.brandId.toString(), error }); }
  }
  logger.info("growth.sweep_done", stats);
  return stats;
}

export async function registerGrowthSweep() {
  const { queuesEnabled } = await import("@/lib/queue/connection");
  if (!queuesEnabled()) return false;
  const { growthQueue } = await import("@/lib/queue/queues");
  const pattern = process.env.GROWTH_SWEEP_CRON ?? "17 * * * *";
  await growthQueue().add("growth-sweep", { sweep: true }, { jobId: "growth-sweep", repeat: { pattern }, attempts: 1 });
  return true;
}

// ───────────────────────────── read model ─────────────────────────────

export async function listGrowthPlans(scope: AdsScope, take = 20) {
  const plans = await prisma.salesGrowthPlan.findMany({ where: { orgId: scope.orgId, brandId: scope.brandId }, orderBy: { createdAt: "desc" }, take, include: { planActions: { orderBy: [{ priority: "asc" }, { id: "asc" }] } } });
  return plans.map(planView);
}

export async function getGrowthPlan(scope: AdsScope, id: string) {
  const plan = await loadPlan(scope, id);
  if (plan.status === "MATERIALIZED") await syncPlanActions(plan.id);
  const full = await prisma.salesGrowthPlan.findUniqueOrThrow({ where: { id: plan.id }, include: { planActions: { orderBy: [{ priority: "asc" }, { id: "asc" }] } } });
  return planView(full);
}

type PlanWithActions = Prisma.SalesGrowthPlanGetPayload<{ include: { planActions: true } }>;
function planView(p: PlanWithActions) {
  const snapshot = new Map(((p.actions ?? []) as unknown as (PlanAction & Record<string, unknown>)[]).map((a) => [a.id, a]));
  return {
    id: p.id.toString(), goalId: p.goalId.toString(), status: p.status, trigger: p.trigger, error: p.error, attempts: p.attempts,
    baseline: p.baseline, forecast: p.forecast, agentReviews: p.agentReviews, dataAsOf: p.dataAsOf ? iso(p.dataAsOf) : null, model: p.model,
    createdBy: p.createdBy, createdAt: p.createdAt, startedAt: p.startedAt, finishedAt: p.finishedAt, approvedBy: p.approvedBy, approvedAt: p.approvedAt,
    materializedAt: p.materializedAt, measuredAt: p.measuredAt, completedAt: p.completedAt, outcome: p.outcome,
    actions: p.planActions.map((a) => {
      const s: Record<string, any> = snapshot.get(a.actionKey) ?? {};
      return { id: a.actionKey, type: a.type, title: a.title, status: a.status, error: a.error, decidedBy: a.decidedBy, campaignId: a.campaignId, remoteCampaignId: a.remoteCampaignId,
        reason: s.reason ?? "", expectedImpact: s.expectedImpact ?? "", confidence: s.confidence ?? "", evidence: (s.evidence as string[] | undefined) ?? [],
        currentValue: s.currentValue ?? null, proposedValue: s.proposedValue ?? null, forecastSalesDelta: a.forecastSalesDelta };
    }),
  };
}
export type GrowthPlanView = ReturnType<typeof planView>;
