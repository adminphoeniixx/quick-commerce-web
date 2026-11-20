import { describe, expect, it } from "vitest";
import { actionStatusFromBid, actionStatusFromProposal, allocateCampaignBudget, autopilotDue, computeOutcome, evidenceAgeDays, evidenceStale } from "./growth-rules";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const forecast = { targetSales: 12_000, projectedAttributedSalesLow: 10_000, projectedAttributedSalesHigh: 14_000 };

describe("evidence freshness", () => {
  it("counts whole UTC days and expires after 3", () => {
    expect(evidenceAgeDays(d("2026-11-16"), new Date("2026-11-19T23:00:00Z"))).toBe(3);
    expect(evidenceStale(d("2026-11-16"), new Date("2026-11-19T23:00:00Z"))).toBe(false);
    expect(evidenceStale(d("2026-11-15"), new Date("2026-11-19T01:00:00Z"))).toBe(true);
    expect(evidenceStale(null, new Date())).toBe(true);
  });
});

describe("autopilot", () => {
  const base = { autopilot: true, replanEveryDays: 7, openPlans: 0, runningMeasurement: false, lastPlanAt: d("2026-11-10"), now: d("2026-11-17") };
  it("re-plans on cadence only when no plan is open or being measured", () => {
    expect(autopilotDue(base)).toBe(true);
    expect(autopilotDue({ ...base, now: d("2026-11-16") })).toBe(false);
    expect(autopilotDue({ ...base, openPlans: 1 })).toBe(false);
    expect(autopilotDue({ ...base, runningMeasurement: true })).toBe(false);
    expect(autopilotDue({ ...base, autopilot: false })).toBe(false);
    expect(autopilotDue({ ...base, lastPlanAt: null })).toBe(true);
  });
});

describe("execution status mapping", () => {
  it("maps bid and campaign queue states", () => {
    expect(actionStatusFromBid("PENDING")).toBe("DRAFTED");
    expect(actionStatusFromBid("APPLYING")).toBe("DRAFTED");
    expect(actionStatusFromBid("APPLIED")).toBe("LIVE");
    expect(actionStatusFromBid("CONFLICT")).toBe("FAILED");
    expect(actionStatusFromBid("CANCELLED")).toBe("DISCARDED");
    expect(actionStatusFromProposal("PENDING_APPROVAL")).toBe("DRAFTED");
    expect(actionStatusFromProposal("APPLIED")).toBe("LIVE");
    expect(actionStatusFromProposal("RECONCILE_REQUIRED")).toBe("FAILED");
    expect(actionStatusFromProposal("REJECTED")).toBe("DISCARDED");
  });
});

describe("budget ceiling at draft time", () => {
  it("admits campaigns in order while the ceiling holds", () => {
    const r = allocateCampaignBudget([{ budget: 600 }, { budget: 500 }, { budget: 300 }, { budget: 0 }], 4000, 5000);
    expect(r.admitted).toEqual([{ budget: 600 }, { budget: 300 }]);
    expect(r.blocked).toEqual([{ budget: 500 }, { budget: 0 }]);
    expect(r.remaining).toBe(100);
  });
  it("blocks everything when active budgets already exceed the ceiling", () => {
    expect(allocateCampaignBudget([{ budget: 10 }], 6000, 5000).admitted).toEqual([]);
  });
});

describe("outcome measurement", () => {
  const baseline = [{ campaignId: "A", sales: 3000, spend: 1000 }, { campaignId: "B", sales: 3000, spend: 1000 }];
  it("scales the baseline to elapsed days and isolates lift against control campaigns", () => {
    // 30-day baseline, 15 days elapsed: comparable baseline per campaign = 1500.
    const current = [{ campaignId: "A", sales: 1950, spend: 600 }, { campaignId: "B", sales: 1650, spend: 500 }];
    const o = computeOutcome({ baseline, baselineDays: 30, current, elapsedDays: 15, horizonDays: 30, treatedCampaignIds: ["A"], forecast });
    expect(o.measurementStatus).toBe("IN_PROGRESS");
    expect(o.comparableBaselineSales).toBe(3000);
    expect(o.salesChangePct).toBeCloseTo(20);
    expect(o.treatedGrowthPct).toBeCloseTo(30);
    expect(o.controlGrowthPct).toBeCloseTo(10);
    expect(o.estimatedLiftPct).toBeCloseTo(20);
    expect(o.forecastLowToDate).toBe(5000);
    expect(o.forecastVerdict).toBe("BELOW_FORECAST");
    expect(o.runRateProjection).toBe(7200);
    expect(o.onTrackForTarget).toBe(false);
  });
  it("counts new campaigns as incremental and completes at the horizon", () => {
    const current = [...baseline, { campaignId: "NEW", sales: 5000, spend: 1500 }];
    const o = computeOutcome({ baseline, baselineDays: 30, current, elapsedDays: 30, horizonDays: 30, treatedCampaignIds: ["NEW"], forecast });
    expect(o.measurementStatus).toBe("COMPLETE");
    expect(o.newCampaignSales).toBe(5000);
    expect(o.treatedGrowthPct).toBeNull();
    expect(o.estimatedLiftPct).toBeNull();
    expect(o.forecastVerdict).toBe("WITHIN_FORECAST");
  });
});
