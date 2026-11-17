import { describe, expect, it } from "vitest";
import { suggestCampaigns, type SuggestionSource } from "./campaign-suggestions";

const source = (patch: Partial<SuggestionSource> = {}): SuggestionSource => ({
  campaignId: "10", name: "Protein Search", type: "PRODUCT_LISTING", status: "ACTIVE", budget: 1000,
  endAt: null, productIds: ["p1", "p2"], period: { spend: 500, sales: 1500, roas: 3, impressions: 10000 }, ...patch,
});

describe("suggestCampaigns", () => {
  it("creates an explainable draft without launching anything", () => {
    const [draft] = suggestCampaigns([source()], new Date("2026-11-17T00:00:00Z"));
    expect(draft).toMatchObject({ templateId: "10", budget: 1100, start: "2026-11-18", end: "2026-12-01", expectedStatus: "ACTIVE", confidence: "low", launchReady: false });
    expect(draft.reason.toLowerCase()).toContain("strong historical roas");
    expect(draft.projectedSales.high).toBeLessThanOrEqual(draft.maximumSpend * 3);
  });
  it("does not suggest unusable or already generated templates", () => {
    expect(suggestCampaigns([source({ budget: null }), source({ campaignId: "11", name: "QCP · old" })])).toEqual([]);
  });
  it("keeps a genuine zero lower quantile at zero", () => {
    const daily = Array.from({ length: 21 }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, "0")}`, spend: 100, sales: i < 8 ? 0 : 300, qty: 1, impressions: 100 }));
    const [draft] = suggestCampaigns([source({ status: "STOPPED", daily, period: { spend: 2100, sales: 3900, roas: 3900 / 2100, impressions: 2100 } })], new Date("2026-11-21T00:00:00Z"));
    expect(draft.projectedRoas.low).toBe(0);
  });
  it("blocks active campaign duplication even with strong fresh evidence", () => {
    const daily = Array.from({ length: 21 }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, "0")}`, spend: 200, sales: 600, qty: 2, impressions: 100 }));
    const [draft] = suggestCampaigns([source({ daily, period: { spend: 4200, sales: 12600, roas: 3, impressions: 2100 } })], new Date("2026-11-21T00:00:00Z"));
    expect(draft.launchReady).toBe(false);
  });
});
