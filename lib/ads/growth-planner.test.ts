import { describe, expect, it } from "vitest";
import { bidSalesDelta, campaignOperationallySafe } from "./growth-planner";

describe("sales-growth deterministic gates", () => {
  it("blocks campaigns when fresh stock or availability proof is missing", () => {
    expect(campaignOperationallySafe(undefined)).toBe(false);
    expect(campaignOperationallySafe({ sellableUnits: null, minimumAvailabilityPct: 90 })).toBe(false);
    expect(campaignOperationallySafe({ sellableUnits: 20, minimumAvailabilityPct: null })).toBe(false);
    expect(campaignOperationallySafe({ sellableUnits: 0, minimumAvailabilityPct: 90 })).toBe(false);
    expect(campaignOperationallySafe({ sellableUnits: 20, minimumAvailabilityPct: 49.9 })).toBe(false);
    expect(campaignOperationallySafe({ sellableUnits: 20, minimumAvailabilityPct: 50 })).toBe(true);
  });

  it("uses horizon-normalized bounded upside for bid increases", () => {
    expect(bidSalesDelta({ sales: 3_000, changePct: 10, action: "increase" }, 30, 30)).toEqual({ low: 0, high: 300 });
    expect(bidSalesDelta({ sales: 3_000, changePct: 40, action: "increase" }, 30, 30)).toEqual({ low: 0, high: 450 });
  });

  it("models possible sales loss for bid decreases", () => {
    expect(bidSalesDelta({ sales: 3_000, changePct: -10, action: "decrease" }, 30, 60)).toEqual({ low: -600, high: 0 });
  });
});
