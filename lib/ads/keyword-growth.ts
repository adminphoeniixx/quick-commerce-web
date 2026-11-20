// Keyword Growth Agent: decides, per keyword in the database, how sales should grow given its rank.
// Exactly one decision per keyword (a–f below) plus campaign-level restart / stop. Deterministic rules
// own every number; specialist agents review, people approve, nothing executes on its own.
import { prisma } from "@/lib/db";
import type { AdsScope, Range } from "./queries";
import type { BidRecommendation, BidRecommendationInput } from "./bid-recommendations";
import type { MarketInsight } from "./market-learning";

export const MIN_EVIDENCE_SPEND = 500;
export const MIN_AVAILABILITY_PCT = 50;
export const BUDGET_CAPPED_USE = 0.9;
export const BUDGET_UP_PCT = 20;
export const TOP_RANK = 3;
export const STOP_ROAS_FRACTION = 0.5;
export const STOP_SPEND_BUDGET_MULTIPLE = 3;

export type KeywordDecisionKind = "HOLD_STOCK" | "BID_DOWN_ROAS" | "BID_DOWN_ORGANIC" | "BUDGET_UP" | "BID_UP" | "HOLD";
export type CampaignChangeKind = "update" | "restart" | "stop";

export interface KeywordInput extends BidRecommendationInput {
  budgetUse: number | null; // 7-day spend ÷ (daily budget × 7)
  marketInsight?: MarketInsight | null;
}

export interface KeywordDecision {
  campaignId: string; campaignName: string; keyword: string; matchType: string;
  organicRank: number | null; adPosition: number | null; roas: number | null; spend: number; sales: number;
  budgetUse: number | null; sellableUnits: number | null; availabilityPct: number | null;
  decision: KeywordDecisionKind; reason: string; bidChangePct: number | null;
}

export interface CampaignState {
  campaignId: string; name: string; status: string; budget: number | null;
  spend14: number; sales14: number; spend30: number; sales30: number; stockOk: boolean;
}

export interface CampaignChangeDraft {
  id: string; kind: CampaignChangeKind; campaignId: string; name: string;
  currentStatus: string; currentBudget: number | null; toBudget: number | null;
  reason: string; evidence: string[]; keywords: string[];
  roas14: number | null; roas30: number | null; spend14: number; budgetUse: number | null;
  forecastSalesDelta: { low: number; high: number };
}

const round10 = (v: number) => Math.round(v / 10) * 10;
const money = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

/** One decision per keyword, checked in order a–f. */
export function decideKeyword(row: KeywordInput, minimumRoas: number): { kind: KeywordDecisionKind; reason: string; pct: number | null } {
  const r = row.research, roas = row.roas ?? 0, rank = r?.organicRank ?? null, adPos = row.position;
  const rankText = rank == null ? "organic rank unknown" : `organic rank ${rank}`;
  if ((r?.sellableUnits != null && r.sellableUnits <= 0) || (r?.availabilityPct != null && r.availabilityPct < MIN_AVAILABILITY_PCT))
    return { kind: "HOLD_STOCK", reason: `Fix stock first: ${r?.sellableUnits ?? "?"} sellable units, ${r?.availabilityPct?.toFixed(0) ?? "?"}% availability. More ad spend would be wasted.`, pct: null };
  if (row.spend >= MIN_EVIDENCE_SPEND && roas < minimumRoas)
    return { kind: "BID_DOWN_ROAS", reason: `${roas.toFixed(2)}x ROAS is below the ${minimumRoas}x goal on ${money(row.spend)} spend (${rankText}).`, pct: roas < minimumRoas * 0.5 ? -15 : -10 };
  if (row.spend < MIN_EVIDENCE_SPEND) return { kind: "HOLD", reason: `Only ${money(row.spend)} spend in 14 days: not enough evidence to change anything.`, pct: null };
  if (rank != null && rank <= TOP_RANK)
    return { kind: "BID_DOWN_ORGANIC", reason: `Already organic rank ${rank}: paying for the top slot mostly buys sales that would come organically. A small bid cut protects margin.`, pct: adPos != null && adPos <= 2 ? -10 : -5 };
  if (row.budgetUse != null && row.budgetUse >= BUDGET_CAPPED_USE)
    return { kind: "BUDGET_UP", reason: `${rankText}, ${roas.toFixed(2)}x ROAS, but the campaign already spends ${(row.budgetUse * 100).toFixed(0)}% of its budget: a higher bid cannot buy more reach, a bigger budget can.`, pct: null };
  if (rank != null && adPos != null && adPos > TOP_RANK)
    return { kind: "BID_UP", reason: `Organic rank ${rank} and ad position ${adPos.toFixed(1)} with ${roas.toFixed(2)}x ROAS and budget room: a higher bid can win better slots profitably.`, pct: rank > 10 ? 15 : 10 };
  return { kind: "HOLD", reason: rank == null ? `ROAS ${roas.toFixed(2)}x is fine but organic rank is unknown: refresh web data before raising bids.` : `ROAS ${roas.toFixed(2)}x, ${rankText}, ad position ${adPos?.toFixed(1) ?? "—"}: already well placed.`, pct: null };
}

/** Turns a bid decision into the BidRecommendation shape the bid agents, forecasts and proposeBids already use. */
export function toBidRecommendation(row: KeywordInput, d: { kind: KeywordDecisionKind; reason: string; pct: number | null }, limits: { min: number; max: number }): BidRecommendation | null {
  if (d.pct == null || row.campaignStatus !== "ACTIVE" || row.cpm == null || row.hasOpenChange) return null;
  const toCpm = Math.max(limits.min, Math.min(limits.max, round10((row.cpm * (100 + d.pct)) / 100)));
  if (toCpm === row.cpm) return null;
  const changePct = ((toCpm - row.cpm) / row.cpm) * 100, up = changePct > 0, r = row.research;
  const objective = d.kind === "BID_UP" ? "Win better rank" : d.kind === "BID_DOWN_ORGANIC" ? "Protect organic sales" : "Fix weak ROAS";
  return {
    ...row, id: `${row.campaignId}|${row.keyword.toLowerCase()}|${row.matchType}`, toCpm, changePct, action: up ? "increase" : "decrease", objective, reason: d.reason,
    confidence: row.spend >= 1500 ? "high" : "medium",
    expectedImpact: up ? `Auction ceiling rises ${changePct.toFixed(0)}%; better slots and more impressions are likely, spend rises too. Rollback if 7-day ROAS falls below goal.` : `Auction ceiling falls ${Math.abs(changePct).toFixed(0)}%; spend falls, some attributed sales may too. Rollback if rank or sales drop materially.`,
    decisionFactors: [`Decision ${d.kind}`, `₹${Math.round(row.spend)} spend · ₹${Math.round(row.sales)} sales · ${(row.roas ?? 0).toFixed(2)}x ROAS (14 days)`, `Organic rank ${r?.organicRank ?? "unknown"} · ad position ${row.position ?? "—"}`, `Budget use ${row.budgetUse == null ? "—" : `${(row.budgetUse * 100).toFixed(0)}%`}`, ...(r?.availabilityPct != null ? [`Availability ${r.availabilityPct.toFixed(0)}%`] : []), ...(r?.ownPrice != null && r.competitorMedianPrice != null ? [`Price ₹${r.ownPrice} vs competitor median ₹${r.competitorMedianPrice}`] : [])],
  };
}

/** Campaign-level changes: budget up (combined per campaign, within the ceiling), restart, stop. One per campaign. */
export function decideCampaigns(input: {
  decisions: KeywordDecision[]; campaigns: CampaignState[]; minimumRoas: number; maxDailyAdSpend: number; horizonDays: number;
}): { changes: CampaignChangeDraft[]; ceilingBlocked: string[] } {
  const changes: CampaignChangeDraft[] = [], ceilingBlocked: string[] = [];
  const byId = new Map(input.campaigns.map((c) => [c.campaignId, c]));
  let room = Math.max(0, input.maxDailyAdSpend - input.campaigns.filter((c) => c.status === "ACTIVE").reduce((a, c) => a + (c.budget ?? 0), 0));
  const roas = (s: number, sp: number) => ratio(s, sp);

  // Stop first: a losing campaign gets no more budget.
  const stopping = new Set<string>();
  for (const c of input.campaigns) {
    const r14 = roas(c.sales14, c.spend14);
    if (c.status !== "ACTIVE" || !c.budget || r14 == null) continue;
    if (r14 < input.minimumRoas * STOP_ROAS_FRACTION && c.spend14 >= c.budget * STOP_SPEND_BUDGET_MULTIPLE) {
      stopping.add(c.campaignId);
      changes.push({ id: `cc:${c.campaignId}:stop`, kind: "stop", campaignId: c.campaignId, name: c.name, currentStatus: c.status, currentBudget: c.budget, toBudget: null,
        reason: `${r14.toFixed(2)}x ROAS over 14 days is below half the ${input.minimumRoas}x goal on ${money(c.spend14)} spend (${(c.spend14 / c.budget).toFixed(1)}× its daily budget).`,
        evidence: [`14-day spend ${money(c.spend14)} · sales ${money(c.sales14)}`, `Daily budget ${money(c.budget)}`], keywords: input.decisions.filter((d) => d.campaignId === c.campaignId).map((d) => d.keyword),
        roas14: r14, roas30: roas(c.sales30, c.spend30), spend14: c.spend14, budgetUse: null, forecastSalesDelta: { low: -(c.sales14 / 14) * input.horizonDays, high: 0 } });
    }
  }

  // Budget up: campaigns with ≥1 BUDGET_UP keyword, strongest attributed sales first, within the ceiling.
  const wanting = new Map<string, KeywordDecision[]>();
  for (const d of input.decisions) if (d.decision === "BUDGET_UP" && !stopping.has(d.campaignId)) wanting.set(d.campaignId, [...(wanting.get(d.campaignId) ?? []), d]);
  const ranked = [...wanting.entries()].sort((a, b) => b[1].reduce((s, d) => s + d.sales, 0) - a[1].reduce((s, d) => s + d.sales, 0));
  for (const [campaignId, kws] of ranked) {
    const c = byId.get(campaignId);
    if (!c?.budget || c.status !== "ACTIVE") continue;
    const toBudget = Math.round(c.budget * (1 + BUDGET_UP_PCT / 100)), extra = toBudget - c.budget;
    if (extra > room) { ceilingBlocked.push(campaignId); continue; }
    room -= extra;
    const r14 = roas(c.sales14, c.spend14) ?? 0;
    changes.push({ id: `cc:${campaignId}:update`, kind: "update", campaignId, name: c.name, currentStatus: c.status, currentBudget: c.budget, toBudget,
      reason: `${kws.length} keyword(s) (${kws.slice(0, 3).map((k) => k.keyword).join(", ")}) need more reach and the campaign is budget-capped at ${((kws[0].budgetUse ?? 0) * 100).toFixed(0)}% use with ${r14.toFixed(2)}x ROAS.`,
      evidence: [`Budget ${money(c.budget)} → ${money(toBudget)} per day (+${BUDGET_UP_PCT}%)`, `14-day spend ${money(c.spend14)} · sales ${money(c.sales14)} · ${r14.toFixed(2)}x ROAS`, ...kws.slice(0, 3).map((k) => `${k.keyword}: organic rank ${k.organicRank ?? "unknown"}, ad position ${k.adPosition ?? "—"}`)],
      keywords: kws.map((k) => k.keyword), roas14: r14, roas30: roas(c.sales30, c.spend30), spend14: c.spend14, budgetUse: kws[0].budgetUse,
      forecastSalesDelta: { low: 0, high: extra * input.horizonDays * r14 } });
  }

  // Restart: stopped campaigns that were profitable in the last 30 days and still have stock.
  for (const c of input.campaigns) {
    const r30 = roas(c.sales30, c.spend30);
    if (c.status !== "STOPPED" || !c.budget || r30 == null || r30 < input.minimumRoas || c.spend30 < MIN_EVIDENCE_SPEND || !c.stockOk) continue;
    if (c.budget > room) { ceilingBlocked.push(c.campaignId); continue; }
    room -= c.budget;
    changes.push({ id: `cc:${c.campaignId}:restart`, kind: "restart", campaignId: c.campaignId, name: c.name, currentStatus: c.status, currentBudget: c.budget, toBudget: c.budget,
      reason: `Stopped, but earned ${r30.toFixed(2)}x ROAS on ${money(c.spend30)} spend in the last 30 days and its products are in stock.`,
      evidence: [`30-day spend ${money(c.spend30)} · sales ${money(c.sales30)}`, `Restart at its last budget ${money(c.budget)}/day`], keywords: [],
      roas14: roas(c.sales14, c.spend14), roas30: r30, spend14: c.spend14, budgetUse: null,
      forecastSalesDelta: { low: c.budget * input.horizonDays * r30 * 0.5, high: c.budget * input.horizonDays * r30 } });
  }
  return { changes, ceilingBlocked };
}

// ───────────────────────────── data loading ─────────────────────────────

/** Budget use and 14/30-day results per campaign, plus whether its products have sellable stock. */
export async function loadCampaignStates(scope: AdsScope, to: Date): Promise<CampaignState[]> {
  const d14 = new Date(to.getTime() - 13 * 86_400_000), d30 = new Date(to.getTime() - 29 * 86_400_000);
  const [campaigns, daily] = await Promise.all([
    prisma.adCampaign.findMany({ where: { brandId: scope.brandId, platformId: scope.platformId }, select: { campaignId: true, name: true, status: true, budget: true, productIds: true } }),
    prisma.adCampaignDaily.groupBy({ by: ["campaignId"], where: { brandId: scope.brandId, platformId: scope.platformId, date: { gte: d30, lte: to } }, _sum: { spend: true, totalSales: true } }),
  ]);
  const daily14 = await prisma.adCampaignDaily.groupBy({ by: ["campaignId"], where: { brandId: scope.brandId, platformId: scope.platformId, date: { gte: d14, lte: to } }, _sum: { spend: true, totalSales: true } });
  const s30 = new Map(daily.map((r) => [r.campaignId, r._sum])), s14 = new Map(daily14.map((r) => [r.campaignId, r._sum]));
  // Stock: latest Seller inventory snapshot, summed per campaign product.
  let stock = new Map<string, number>();
  if (scope.sellerPlatformId) {
    const latest = await prisma.channelInventory.findFirst({ where: { brandId: scope.brandId, platformId: scope.sellerPlatformId }, orderBy: { snapshotDate: "desc" }, select: { snapshotDate: true } });
    const productIds = [...new Set(campaigns.flatMap((c) => c.productIds))];
    if (latest && productIds.length) {
      const products = await prisma.channelProduct.findMany({ where: { brandId: scope.brandId, platformId: scope.sellerPlatformId, productId: { in: productIds } }, select: { productId: true, itemId: true } });
      const inv = await prisma.channelInventory.groupBy({ by: ["itemId"], where: { brandId: scope.brandId, platformId: scope.sellerPlatformId, snapshotDate: latest.snapshotDate, itemId: { in: products.map((p) => p.itemId) } }, _sum: { totalSellable: true } });
      const byItem = new Map(inv.map((r) => [r.itemId, r._sum.totalSellable ?? 0]));
      stock = new Map(products.flatMap((p) => (p.productId ? [[p.productId, byItem.get(p.itemId) ?? 0] as const] : [])));
    }
  }
  return campaigns.map((c) => ({
    campaignId: c.campaignId, name: c.name, status: c.status, budget: c.budget == null ? null : Number(c.budget),
    spend14: Number(s14.get(c.campaignId)?.spend ?? 0), sales14: Number(s14.get(c.campaignId)?.totalSales ?? 0),
    spend30: Number(s30.get(c.campaignId)?.spend ?? 0), sales30: Number(s30.get(c.campaignId)?.totalSales ?? 0),
    stockOk: c.productIds.length > 0 && c.productIds.every((p) => (stock.get(p) ?? 0) > 0),
  }));
}

/** 7-day budget use per active campaign. */
export async function loadBudgetUse(scope: AdsScope, to: Date) {
  const d7 = new Date(to.getTime() - 6 * 86_400_000);
  const [campaigns, spend] = await Promise.all([
    prisma.adCampaign.findMany({ where: { brandId: scope.brandId, platformId: scope.platformId }, select: { campaignId: true, budget: true } }),
    prisma.adCampaignDaily.groupBy({ by: ["campaignId"], where: { brandId: scope.brandId, platformId: scope.platformId, date: { gte: d7, lte: to } }, _sum: { spend: true } }),
  ]);
  const s = new Map(spend.map((r) => [r.campaignId, Number(r._sum.spend ?? 0)]));
  return new Map(campaigns.map((c) => [c.campaignId, c.budget && Number(c.budget) > 0 ? (s.get(c.campaignId) ?? 0) / (Number(c.budget) * 7) : null]));
}

export function toDecision(row: KeywordInput, d: { kind: KeywordDecisionKind; reason: string; pct: number | null }): KeywordDecision {
  return { campaignId: row.campaignId, campaignName: row.campaignName, keyword: row.keyword, matchType: row.matchType, organicRank: row.research?.organicRank ?? null, adPosition: row.position, roas: row.roas, spend: row.spend, sales: row.sales,
    budgetUse: row.budgetUse, sellableUnits: row.research?.sellableUnits ?? null, availabilityPct: row.research?.availabilityPct ?? null, decision: d.kind, reason: d.reason, bidChangePct: d.pct };
}

export type KeywordRange = Range;

/** Full keyword board for a brand: every keyword's decision, bid recommendations and campaign changes. */
export async function buildKeywordBoard(scope: AdsScope, goal: { minimumRoas: number; maxDailyAdSpend: number; horizonDays: number }, to: Date) {
  const [{ listBids }, { addBidResearch }, { marketInsightsFor }] = await Promise.all([import("./bids"), import("./bid-research"), import("./market-learning")]);
  const range14 = { from: new Date(to.getTime() - 13 * 86_400_000), to };
  const [bidData, budgetUse, campaigns, market] = await Promise.all([listBids(scope, range14, { activeOnly: true }), loadBudgetUse(scope, to), loadCampaignStates(scope, to), marketInsightsFor(scope.brandId)]);
  const rows: BidRecommendationInput[] = bidData.campaigns.flatMap((campaign) => campaign.keywords.flatMap((keyword) => keyword.bids.map((bid) => ({ campaignId: campaign.campaignId, campaignName: campaign.name, campaignStatus: campaign.status, keyword: keyword.keyword, matchType: bid.matchType, cpm: bid.cpm, hasOpenChange: !!bid.open, impressions: bid.perf?.impressions ?? 0, spend: bid.perf?.spend ?? 0, sales: bid.perf?.sales ?? 0, atc: bid.perf?.atc ?? 0, position: bid.perf?.position ?? null, roas: bid.perf?.roas ?? null }))));
  const researched = await addBidResearch(scope, rows, range14);
  const inputs: KeywordInput[] = researched.map((row) => ({ ...row, budgetUse: budgetUse.get(row.campaignId) ?? null, marketInsight: market(row.keyword) }));
  const decided = inputs.map((row) => ({ row, d: decideKeyword(row, goal.minimumRoas) }));
  const decisions = decided.map(({ row, d }) => toDecision(row, d));
  const { changes, ceilingBlocked } = decideCampaigns({ decisions, campaigns, minimumRoas: goal.minimumRoas, maxDailyAdSpend: goal.maxDailyAdSpend, horizonDays: goal.horizonDays });
  const stopping = new Set(changes.filter((c) => c.kind === "stop").map((c) => c.campaignId)), blocked = new Set(ceilingBlocked);
  for (const d of decisions) {
    if (d.decision === "BUDGET_UP" && blocked.has(d.campaignId)) d.reason += " Blocked: the daily ad-spend ceiling has no room for a bigger budget.";
    if (stopping.has(d.campaignId) && d.decision !== "BID_DOWN_ROAS") d.reason += " The campaign itself is proposed to stop.";
  }
  const bids = decided.flatMap(({ row, d }) => (stopping.has(row.campaignId) && (d.pct ?? 0) > 0 ? [] : [toBidRecommendation(row, d, bidData.limits)].filter((b): b is BidRecommendation => !!b)));
  return { decisions, bids, campaignChanges: changes, limits: bidData.limits };
}
