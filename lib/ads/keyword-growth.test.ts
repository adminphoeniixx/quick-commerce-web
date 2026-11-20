import { describe, expect, it } from "vitest";
import { decideCampaigns, decideKeyword, toBidRecommendation, toDecision, type CampaignState, type KeywordInput } from "./keyword-growth";
import { changeConsensus, normalizeChangeAgentResponse } from "./campaign-change-agents";
import { campaignActionFor } from "./campaign-changes";
import { actionStatusFromCampaignChange } from "./growth-rules";
import { forecastRatio } from "./growth-learning";

const kw = (o: Partial<KeywordInput> & { research?: Partial<NonNullable<KeywordInput["research"]>> } = {}): KeywordInput => ({
  campaignId: "C1", campaignName: "Camp", campaignStatus: "ACTIVE", keyword: "chips", matchType: "EXACT", cpm: 100, hasOpenChange: false,
  impressions: 5000, spend: 2000, sales: 8000, atc: 50, position: 5, roas: 4, budgetUse: 0.5, ...o,
  research: { roas7d: 4, ownSearchRank: 8, organicRank: 8, availabilityPct: 90, sellableUnits: 100, ownPrice: 50, competitorMedianPrice: 50, previousBid: null, dataWarnings: [], ...(o.research ?? {}) },
});
const MIN = 2;

describe("keyword decisions (a–f, first match wins)", () => {
  it("a: no stock or low availability → HOLD_STOCK, even with bad ROAS", () => {
    expect(decideKeyword(kw({ research: { sellableUnits: 0 } }), MIN).kind).toBe("HOLD_STOCK");
    expect(decideKeyword(kw({ roas: 0.5, research: { availabilityPct: 40 } }), MIN).kind).toBe("HOLD_STOCK");
  });
  it("b: ROAS below goal → BID_DOWN, −15% when below half the goal", () => {
    expect(decideKeyword(kw({ roas: 1.5 }), MIN)).toMatchObject({ kind: "BID_DOWN_ROAS", pct: -10 });
    expect(decideKeyword(kw({ roas: 0.8 }), MIN)).toMatchObject({ kind: "BID_DOWN_ROAS", pct: -15 });
  });
  it("too little spend → HOLD (not enough evidence)", () => {
    expect(decideKeyword(kw({ spend: 300, roas: 0.1 }), MIN).kind).toBe("HOLD");
  });
  it("c: organic top 3 → BID_DOWN_ORGANIC, deeper when the ad also sits top 2", () => {
    expect(decideKeyword(kw({ research: { organicRank: 2 }, position: 1 }), MIN)).toMatchObject({ kind: "BID_DOWN_ORGANIC", pct: -10 });
    expect(decideKeyword(kw({ research: { organicRank: 3 }, position: 4 }), MIN)).toMatchObject({ kind: "BID_DOWN_ORGANIC", pct: -5 });
  });
  it("d: rank > 3 or unknown with budget capped → BUDGET_UP", () => {
    expect(decideKeyword(kw({ budgetUse: 0.95 }), MIN).kind).toBe("BUDGET_UP");
    expect(decideKeyword(kw({ budgetUse: 0.9, research: { organicRank: null } }), MIN).kind).toBe("BUDGET_UP");
  });
  it("e: rank > 3, budget room, ad position > 3 → BID_UP, +15% beyond rank 10", () => {
    expect(decideKeyword(kw({ research: { organicRank: 6 } }), MIN)).toMatchObject({ kind: "BID_UP", pct: 10 });
    expect(decideKeyword(kw({ research: { organicRank: 14 } }), MIN)).toMatchObject({ kind: "BID_UP", pct: 15 });
  });
  it("f: otherwise HOLD (good ad slot, or rank unknown with budget room)", () => {
    expect(decideKeyword(kw({ position: 2 }), MIN).kind).toBe("HOLD");
    expect(decideKeyword(kw({ research: { organicRank: null } }), MIN).kind).toBe("HOLD");
  });
});

describe("bid recommendation from a decision", () => {
  it("rounds to ₹10, respects limits, keeps the reason", () => {
    const row = kw({ research: { organicRank: 14 } }), d = decideKeyword(row, MIN), r = toBidRecommendation(row, d, { min: 50, max: 2000 })!;
    expect(r.toCpm).toBe(120); // 100 × 1.15 = 115 → 120 (round10)
    expect(r.action).toBe("increase");
    expect(r.reason).toBe(d.reason);
  });
  it("no bid for HOLD / BUDGET_UP, paused campaigns or open changes", () => {
    const limits = { min: 50, max: 2000 };
    expect(toBidRecommendation(kw(), decideKeyword(kw({ budgetUse: 0.95 }), MIN), limits)).toBeNull();
    const up = kw({ research: { organicRank: 6 } });
    expect(toBidRecommendation({ ...up, hasOpenChange: true }, decideKeyword(up, MIN), limits)).toBeNull();
    expect(toBidRecommendation({ ...up, campaignStatus: "STOPPED" }, decideKeyword(up, MIN), limits)).toBeNull();
  });
});

const camp = (o: Partial<CampaignState>): CampaignState => ({ campaignId: "C1", name: "Camp", status: "ACTIVE", budget: 1000, spend14: 10000, sales14: 40000, spend30: 20000, sales30: 80000, stockOk: true, ...o });

describe("campaign changes", () => {
  const budgetUp = toDecision(kw({ budgetUse: 0.95 }), decideKeyword(kw({ budgetUse: 0.95 }), MIN));
  it("raises a capped campaign's budget by 20% within the ceiling", () => {
    const r = decideCampaigns({ decisions: [budgetUp], campaigns: [camp({})], minimumRoas: MIN, maxDailyAdSpend: 1500, horizonDays: 30 });
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatchObject({ kind: "update", currentBudget: 1000, toBudget: 1200 });
    expect(r.changes[0].forecastSalesDelta.high).toBeCloseTo(200 * 30 * 4);
  });
  it("blocks a budget raise that does not fit the ceiling", () => {
    const r = decideCampaigns({ decisions: [budgetUp], campaigns: [camp({})], minimumRoas: MIN, maxDailyAdSpend: 1100, horizonDays: 30 });
    expect(r.changes).toHaveLength(0);
    expect(r.ceilingBlocked).toEqual(["C1"]);
  });
  it("stops a deeply losing campaign and gives it no budget", () => {
    const r = decideCampaigns({ decisions: [budgetUp], campaigns: [camp({ spend14: 4000, sales14: 3000 })], minimumRoas: MIN, maxDailyAdSpend: 9999, horizonDays: 30 });
    expect(r.changes.map((c) => c.kind)).toEqual(["stop"]);
    expect(r.changes[0].forecastSalesDelta.low).toBeCloseTo(-(3000 / 14) * 30);
  });
  it("does not stop on a small sample", () => {
    expect(decideCampaigns({ decisions: [], campaigns: [camp({ spend14: 2000, sales14: 500 })], minimumRoas: MIN, maxDailyAdSpend: 9999, horizonDays: 30 }).changes).toEqual([]);
  });
  it("restarts a profitable stopped campaign with stock, not one without", () => {
    const ok = decideCampaigns({ decisions: [], campaigns: [camp({ status: "STOPPED" })], minimumRoas: MIN, maxDailyAdSpend: 5000, horizonDays: 30 });
    expect(ok.changes[0]).toMatchObject({ kind: "restart", toBudget: 1000 });
    expect(decideCampaigns({ decisions: [], campaigns: [camp({ status: "STOPPED", stockOk: false })], minimumRoas: MIN, maxDailyAdSpend: 5000, horizonDays: 30 }).changes).toEqual([]);
    expect(decideCampaigns({ decisions: [], campaigns: [camp({ status: "STOPPED", sales30: 20000 })], minimumRoas: MIN, maxDailyAdSpend: 5000, horizonDays: 30 }).changes).toEqual([]);
  });
});

describe("campaign change agents", () => {
  it("parses valid reviews and drops malformed ones", () => {
    const r = normalizeChangeAgentResponse({ reviews: [{ id: "a", verdict: "approve", summary: "ok", risks: [] }, { id: "b", verdict: "maybe" }] });
    expect(r).toHaveLength(1);
  });
  it("is fail-closed", () => {
    const all = ["Performance agent", "Growth agent", "Risk agent"].map((role) => ({ role, verdict: "approve" as const, summary: "", risks: [] }));
    expect(changeConsensus(all).verdict).toBe("approve");
    expect(changeConsensus(all.slice(0, 2)).verdict).toBe("skip");
    expect(changeConsensus([...all.slice(0, 2), { ...all[2], verdict: "skip" }]).verdict).toBe("skip");
    expect(changeConsensus([...all.slice(0, 2), { ...all[2], verdict: "review" }]).verdict).toBe("review");
  });
});

describe("execution", () => {
  const base = { campaignId: "123", expectedStatus: "ACTIVE", expectedBudget: 1000 };
  it("builds the Blinkit action with the expected-state check", () => {
    expect(campaignActionFor({ ...base, kind: "update", toBudget: 1200 })).toMatchObject({ action: "update", campaign_id: 123, expected_status: "ACTIVE", expected_budget: 1000, budget: 1200 });
    expect(campaignActionFor({ ...base, kind: "stop", toBudget: null })).toMatchObject({ action: "stop" });
    expect(campaignActionFor({ ...base, expectedStatus: "STOPPED", kind: "restart", toBudget: 1000 }, new Date("2026-11-20T00:00:00Z"))).toMatchObject({ action: "restart", start: "2026-11-20", end: "2026-12-03", no_end: false });
    expect(() => campaignActionFor({ ...base, kind: "update", toBudget: null })).toThrow();
  });
  it("maps change status to the growth action", () => {
    expect(actionStatusFromCampaignChange("APPLIED")).toBe("LIVE");
    expect(actionStatusFromCampaignChange("FAILED")).toBe("FAILED");
    expect(actionStatusFromCampaignChange("REJECTED")).toBe("DISCARDED");
    expect(actionStatusFromCampaignChange("PENDING")).toBe("DRAFTED");
  });
  it("stop outcomes compare against the negative forecast", () => {
    expect(forecastRatio("stop", -500, { low: -1000, high: 0 })).toBe(0.5);
  });
});
