import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import type { AdsScope } from "./queries";
import { adsCampaigns, adsMeta } from "./queries";
import { analyzeBidRecommendations } from "./bid-analysis-agents";
import { suggestCampaigns } from "./campaign-suggestions";
import { analyzeWithAgents } from "./campaign-analysis-agents";
import { addCampaignResearch } from "./campaign-research";
import { BadRequest } from "@/lib/http";
import { applyFactor, calibrationFor, pastOutcomesFor } from "./growth-learning";
import { marketInsightsFor } from "./market-learning";
import { buildKeywordBoard } from "./keyword-growth";
import { analyzeCampaignChanges } from "./campaign-change-agents";

export interface GrowthGoalInput { targetSalesGrowthPct: number; maxDailyAdSpend: number; minimumRoas: number; horizonDays: number }

export function bidSalesDelta(input: { sales: number; changePct: number; action: "increase" | "decrease" }, observedDays: number, horizonDays: number) {
  const historicalSales = input.sales / Math.max(1, observedDays) * horizonDays;
  const boundedDelta = historicalSales * Math.min(Math.abs(input.changePct) / 100, .15);
  return input.action === "increase" ? { low: 0, high: boundedDelta } : { low: -boundedDelta, high: 0 };
}

export function campaignOperationallySafe(input: { sellableUnits: number | null; minimumAvailabilityPct: number | null } | undefined) {
  return input?.sellableUnits != null && input.sellableUnits > 0 && input.minimumAvailabilityPct != null && input.minimumAvailabilityPct >= 50;
}

export async function generateGrowthPlan(scope: AdsScope, goal: GrowthGoalInput) {
  const meta = await adsMeta(scope);
  if (!meta.from || !meta.to) throw BadRequest("Sync Blinkit Ads before generating a growth plan");
  const to = new Date(`${meta.to}T00:00:00Z`), earliest = new Date(`${meta.from}T00:00:00Z`);
  const from = new Date(Math.max(earliest.getTime(), to.getTime() - 29 * 86400_000));
  const range = { from, to };
  const [campaignRows, daily] = await Promise.all([
    adsCampaigns(scope, range),
    prisma.adCampaignDaily.findMany({ where: { brandId: scope.brandId, platformId: scope.platformId, date: { gte: from, lte: to } }, select: { campaignId: true, date: true, spend: true, totalSales: true, totalQty: true, impressions: true }, orderBy: { date: "asc" } }),
  ]);
  const [calibrate, history, market] = await Promise.all([calibrationFor(scope.brandId), pastOutcomesFor(scope.brandId), marketInsightsFor(scope.brandId)]);
  // Keyword Growth Agent: one rank-aware decision per keyword; bids and campaign changes come from it.
  const board = await buildKeywordBoard(scope, goal, to);
  const bidDrafts = board.bids.map((row) => ({ ...row, pastOutcomes: history.bid(row.campaignId, row.keyword), marketInsight: market(row.keyword) }));
  const [bidAnalysis, changeAnalysis] = await Promise.all([analyzeBidRecommendations(bidDrafts), analyzeCampaignChanges(board.campaignChanges)]);
  const approvedChanges = changeAnalysis.changes.filter((c) => c.agentConsensus.verdict === "approve");
  const byCampaign = new Map<string, { date: string; spend: number; sales: number; qty: number; impressions: number }[]>();
  for (const day of daily) { const list = byCampaign.get(day.campaignId) ?? []; list.push({ date: day.date.toISOString().slice(0, 10), spend: Number(day.spend), sales: Number(day.totalSales), qty: day.totalQty, impressions: day.impressions }); byCampaign.set(day.campaignId, list); }
  const campaignDrafts = suggestCampaigns(campaignRows.map((row) => ({ ...row, daily: byCampaign.get(row.campaignId) ?? [] })));
  const campaignAnalysis = await analyzeWithAgents((await addCampaignResearch(scope, campaignDrafts, range)).map((row) => ({ ...row, pastOutcomes: history.campaign(row.templateId), marketInsights: (row.salesTools?.topKeywords ?? []).flatMap((k) => { const m = market(k.keyword); return m ? [{ keyword: k.keyword, ...m }] : []; }).slice(0, 3) })));
  const launchCal = calibrate("CAMPAIGN", "launch");
  const observedSpend = campaignRows.reduce((sum, row) => sum + row.period.spend, 0), observedSales = campaignRows.reduce((sum, row) => sum + row.period.sales, 0);
  const observedDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400_000) + 1);
  const baselineSpend = observedSpend / observedDays * goal.horizonDays, baselineSales = observedSales / observedDays * goal.horizonDays;
  const approvedBids = bidAnalysis.recommendations.filter((row) => row.agentConsensus?.verdict === "approve" && (row.action === "decrease" || (row.roas ?? 0) >= goal.minimumRoas));
  const currentDailyBudget = campaignRows.filter((row) => row.status === "ACTIVE").reduce((sum, row) => sum + (row.budget ?? 0), 0);
  const changeBudget = approvedChanges.reduce((sum, c) => sum + (c.kind === "update" ? (c.toBudget ?? 0) - (c.currentBudget ?? 0) : c.kind === "restart" ? c.toBudget ?? 0 : 0), 0);
  let remainingDailyBudget = Math.max(0, goal.maxDailyAdSpend - currentDailyBudget - changeBudget);
  const approvedCampaigns = campaignAnalysis.suggestions
    .filter((row) => row.launchReady && row.agentConsensus?.verdict === "launch" && row.projectedRoas.low >= goal.minimumRoas && campaignOperationallySafe(row.salesTools))
    .sort((a, b) => b.projectedRoas.base - a.projectedRoas.base)
    .filter((row) => { if (row.budget > remainingDailyBudget) return false; remainingDailyBudget -= row.budget; return true; });
  const actions = [
    ...approvedBids.map((row) => { const forecastSalesDelta = applyFactor(bidSalesDelta(row, observedDays, goal.horizonDays), calibrate("BID", row.action).factor); return { type: "BID", id: row.id, priority: row.action === "decrease" ? 1 : 2, title: `${row.objective}: ${row.keyword}`, campaignId: row.campaignId, currentValue: row.cpm, proposedValue: row.toCpm, reason: row.reason, expectedImpact: row.expectedImpact, forecastSalesDelta, confidence: row.confidence, evidence: row.decisionFactors, status: "READY_FOR_APPROVAL", payload: { ...row, forecastSalesDelta } }; }),
    ...approvedCampaigns.map((row) => ({ type: "CAMPAIGN", id: row.id, priority: 3, title: row.name, campaignId: row.templateId, currentValue: 0, proposedValue: row.budget, reason: row.reason, expectedImpact: row.benefitExplanation, forecastSalesDelta: applyFactor({ low: row.projectedSales.low, high: row.projectedSales.high }, launchCal.factor), confidence: row.confidence, evidence: [row.evidence, `${row.salesTools?.sellerUnits ?? 0} seller units · ${row.salesTools?.sellableUnits ?? 0} sellable units`, `${row.salesTools?.minimumAvailabilityPct?.toFixed(0) ?? "—"}% minimum availability · best search rank ${row.salesTools?.bestSearchRank ?? "unavailable"}`, `Own median price ₹${row.salesTools?.ownMedianPrice ?? "—"} · competitor median ₹${row.salesTools?.competitorMedianPrice ?? "—"}`], status: "READY_FOR_APPROVAL", payload: row })),
    ...approvedChanges.map((c) => ({ type: "CAMPAIGN_CHANGE", id: c.id, priority: c.kind === "stop" ? 1 : 3, title: `${c.kind === "update" ? "Raise budget" : c.kind === "restart" ? "Restart" : "Stop"}: ${c.name}`, campaignId: c.campaignId, currentValue: c.currentBudget, proposedValue: c.kind === "stop" ? 0 : c.toBudget, reason: c.reason, expectedImpact: c.agentConsensus.summary, forecastSalesDelta: applyFactor(c.forecastSalesDelta, calibrate("CAMPAIGN", c.kind === "update" ? "budget_up" : c.kind).factor), confidence: c.spend14 >= 3000 ? "high" : "medium", evidence: c.evidence, status: "READY_FOR_APPROVAL", payload: c })),
  ].sort((a, b) => a.priority - b.priority);
  const campaignLow = approvedCampaigns.reduce((sum, row) => sum + row.projectedSales.low, 0) * launchCal.factor, campaignHigh = approvedCampaigns.reduce((sum, row) => sum + row.projectedSales.high, 0) * launchCal.factor;
  const changeActions = actions.filter((action) => action.type === "CAMPAIGN_CHANGE"), changeLow = changeActions.reduce((sum, a) => sum + a.forecastSalesDelta.low, 0), changeHigh = changeActions.reduce((sum, a) => sum + a.forecastSalesDelta.high, 0);
  const bidLow = actions.filter((action) => action.type === "BID").reduce((sum, action) => sum + action.forecastSalesDelta.low, 0), bidHigh = actions.filter((action) => action.type === "BID").reduce((sum, action) => sum + action.forecastSalesDelta.high, 0);
  const operationallyBlockedCampaigns = campaignAnalysis.suggestions.filter((row) => row.launchReady && row.agentConsensus?.verdict === "launch" && !campaignOperationallySafe(row.salesTools)).length;
  const warnings = [
    ...(currentDailyBudget > goal.maxDailyAdSpend ? [`Current active campaign budgets (${Math.round(currentDailyBudget)}/day) exceed the configured ₹${Math.round(goal.maxDailyAdSpend)}/day ceiling; no new campaign spend is allowed.`] : []),
    ...(operationallyBlockedCampaigns ? [`${operationallyBlockedCampaigns} campaign action(s) were blocked because fresh positive stock and at least 50% availability were not proven.`] : []),
    ...(!actions.length ? ["No action passed deterministic and specialist safety gates."] : []),
    "Product COGS is unavailable; forecast is attributed sales, not profit.",
  ];
  const baseline = { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), observedDays, horizonDays: goal.horizonDays, observedSpend, observedAttributedSales: observedSales, spend: baselineSpend, attributedSales: baselineSales, roas: observedSpend ? observedSales / observedSpend : null, activeCampaigns: meta.campaigns.active };
  const targetSales = baselineSales * (1 + goal.targetSalesGrowthPct / 100);
  if (baselineSales + campaignHigh + bidHigh + changeHigh < targetSales) warnings.push(`Safe approved actions do not yet reach the ${goal.targetSalesGrowthPct}% sales target; the planner will not invent unsafe spend.`);
  const forecast = { targetSales, projectedAttributedSalesLow: Math.max(0, baselineSales + campaignLow + bidLow + changeLow), projectedAttributedSalesHigh: baselineSales + campaignHigh + bidHigh + changeHigh, campaignChangeSalesDeltaLow: changeLow, campaignChangeSalesDeltaHigh: changeHigh, bidSalesDeltaLow: bidLow, bidSalesDeltaHigh: bidHigh, campaignSalesDeltaLow: campaignLow, campaignSalesDeltaHigh: campaignHigh, actionCount: actions.length, currentDailyBudget, calibration: { bidIncrease: calibrate("BID", "increase"), bidDecrease: calibrate("BID", "decrease"), campaignLaunch: launchCal }, plannedAdditionalDailyBudget: goal.maxDailyAdSpend - currentDailyBudget - remainingDailyBudget, warnings };
  const agentReviews = { bid: { mode: bidAnalysis.mode, model: bidAnalysis.model, reviewed: bidAnalysis.recommendations.length, approved: approvedBids.length }, campaign: { mode: campaignAnalysis.mode, model: campaignAnalysis.model, reviewed: campaignAnalysis.suggestions.length, approved: approvedCampaigns.length }, campaignChange: { mode: changeAnalysis.mode, model: changeAnalysis.model, reviewed: changeAnalysis.changes.length, approved: approvedChanges.length }, keywords: Object.fromEntries(["HOLD_STOCK", "BID_DOWN_ROAS", "BID_DOWN_ORGANIC", "BUDGET_UP", "BID_UP", "HOLD"].map((k) => [k, board.decisions.filter((d) => d.decision === k).length])) };
  const payloadHash = createHash("sha256").update(JSON.stringify({ goal, baseline, forecast, actions, dataAsOf: meta.to })).digest("hex");
  return { baseline, forecast, actions, agentReviews, dataAsOf: to, model: bidAnalysis.model ?? campaignAnalysis.model ?? null, payloadHash };
}
