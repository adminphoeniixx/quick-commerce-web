import { describe, expect, it } from "vitest";
import { recommendBids, type BidRecommendationInput } from "./bid-recommendations";

const row = (patch: Partial<BidRecommendationInput> = {}): BidRecommendationInput => ({ campaignId: "1", campaignName: "Search", campaignStatus: "ACTIVE", keyword: "dates", matchType: "EXACT", cpm: 200, hasOpenChange: false, impressions: 5000, spend: 1000, sales: 3500, atc: 20, position: 2, roas: 3.5, ...patch });
describe("recommendBids", () => {
  it("increases a proven non-top-slot bid by only 10%", () => expect(recommendBids([row({ position: 3.5 })])[0]).toMatchObject({ toCpm: 220, changePct: 10, action: "increase" }));
  it("reduces zero-sale waste by 15%", () => expect(recommendBids([row({ sales: 0, roas: 0 })])[0]).toMatchObject({ toCpm: 170, changePct: -15, action: "decrease" }));
  it("limits increases to 5% when the keyword already owns a top-two slot", () => expect(recommendBids([row({ position: 1.5 })])[0]).toMatchObject({ toCpm: 210, changePct: 5 }));
  it("limits reductions to 5% when placement is already weak", () => expect(recommendBids([row({ roas: 0.8, position: 6 })])[0]).toMatchObject({ toCpm: 190, changePct: -5 }));
  it("explains ranking evidence and downside", () => {
    const recommendation = recommendBids([row({ roas: 0.8, position: 2.4 })])[0];
    expect(recommendation.reason).toContain("Avg slot 2.4");
    expect(recommendation.decisionFactors).toContain("Avg slot 2.4");
    expect(recommendation.expectedImpact).toContain("attributed sales may also decline");
  });
  it("blocks bid growth when inventory availability or recent ROAS is unsafe", () => {
    const research = { roas7d: 0.8, ownSearchRank: 5, organicRank: null, availabilityPct: 80, sellableUnits: 100, ownPrice: 100, competitorMedianPrice: 110, previousBid: null, dataWarnings: [] };
    expect(recommendBids([row({ research })])).toEqual([]);
    expect(recommendBids([row({ research: { ...research, roas7d: 3.2, availabilityPct: 40 } })])).toEqual([]);
    expect(recommendBids([row({ research: { ...research, roas7d: 3.2, availabilityPct: 80, sellableUnits: 0 } })])).toEqual([]);
  });
  it("uses fresh Blinkit search rank before the aggregate ads slot", () => {
    const research = { roas7d: 3.2, ownSearchRank: 1, organicRank: 4, availabilityPct: 80, sellableUnits: 100, ownPrice: 100, competitorMedianPrice: 110, previousBid: null, dataWarnings: [] };
    expect(recommendBids([row({ position: 8, research })])[0]).toMatchObject({ toCpm: 210, changePct: 5 });
  });
  it("skips inactive, open, weak-data and neutral bids", () => expect(recommendBids([row({ campaignStatus: "STOPPED" }), row({ hasOpenChange: true }), row({ spend: 400 }), row({ roas: 1.5 })])).toEqual([]));
  it("keeps bids inside account limits", () => expect(recommendBids([row({ cpm: 1990 })])[0].toCpm).toBe(2000));
});
