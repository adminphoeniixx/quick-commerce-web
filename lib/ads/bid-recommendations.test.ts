import { describe, expect, it } from "vitest";
import { recommendBids, type BidRecommendationInput } from "./bid-recommendations";

const row = (patch: Partial<BidRecommendationInput> = {}): BidRecommendationInput => ({ campaignId: "1", campaignName: "Search", campaignStatus: "ACTIVE", keyword: "dates", matchType: "EXACT", cpm: 200, hasOpenChange: false, impressions: 5000, spend: 1000, sales: 3500, atc: 20, position: 2, roas: 3.5, ...patch });
describe("recommendBids", () => {
  it("increases proven active bid by only 10%", () => expect(recommendBids([row()])[0]).toMatchObject({ toCpm: 220, changePct: 10, action: "increase" }));
  it("reduces zero-sale waste by 15%", () => expect(recommendBids([row({ sales: 0, roas: 0 })])[0]).toMatchObject({ toCpm: 170, changePct: -15, action: "decrease" }));
  it("skips inactive, open, weak-data and neutral bids", () => expect(recommendBids([row({ campaignStatus: "STOPPED" }), row({ hasOpenChange: true }), row({ spend: 400 }), row({ roas: 1.5 })])).toEqual([]));
  it("keeps bids inside account limits", () => expect(recommendBids([row({ cpm: 1990 })])[0].toCpm).toBe(2000));
});
