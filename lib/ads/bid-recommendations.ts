export interface BidRecommendationInput {
  campaignId: string; campaignName: string; campaignStatus: string; keyword: string; matchType: string;
  cpm: number | null; hasOpenChange: boolean; impressions: number; spend: number; sales: number; atc: number; position: number | null; roas: number | null;
}

export interface BidAgentReview { role: string; verdict: "approve" | "review" | "skip"; summary: string; risks: string[] }
export interface BidRecommendation extends BidRecommendationInput {
  id: string; toCpm: number; changePct: number; action: "increase" | "decrease"; objective: string; reason: string;
  confidence: "medium" | "high"; expectedImpact: string; agentConsensus?: { verdict: "approve" | "review" | "skip"; summary: string; reviews: BidAgentReview[] };
}

const round10 = (value: number) => Math.round(value / 10) * 10;

/** Deterministic bounds own every number. AI may review and explain, never set a bid. */
export function recommendBids(rows: BidRecommendationInput[], limits = { min: 50, max: 2000 }): BidRecommendation[] {
  return rows.flatMap((row) => {
    if (row.campaignStatus !== "ACTIVE" || row.cpm == null || row.hasOpenChange || row.spend < 500) return [];
    const roas = row.roas ?? 0;
    let changePct = 0, objective = "", reason = "", confidence: "medium" | "high" = "medium";
    if (row.sales === 0 && row.spend >= 1000) { changePct = -15; objective = "Reduce wasted spend"; reason = `₹${Math.round(row.spend).toLocaleString("en-IN")} spend produced no attributed sales.`; confidence = "high"; }
    else if (roas < 1) { changePct = -10; objective = "Protect margin"; reason = `${roas.toFixed(2)}x ROAS is below ad-spend break-even before product cost.`; }
    else if (roas >= 3 && row.impressions >= 1000 && row.sales >= 1500) { changePct = 10; objective = "Capture more sales"; reason = `${roas.toFixed(2)}x ROAS has enough impressions and attributed sales for a controlled increase.`; confidence = row.spend >= 1500 ? "high" : "medium"; }
    if (!changePct) return [];
    const toCpm = Math.max(limits.min, Math.min(limits.max, round10(row.cpm * (1 + changePct / 100))));
    if (toCpm === row.cpm) return [];
    return [{ ...row, id: `${row.campaignId}|${row.keyword.toLowerCase()}|${row.matchType}`, toCpm, changePct, action: changePct > 0 ? "increase" as const : "decrease" as const, objective, reason, confidence,
      expectedImpact: changePct > 0 ? "May win more eligible auctions while limiting bid growth to 10%." : "Reduces future auction cost exposure; sales can also fall." }];
  }).sort((a, b) => (a.action === "decrease" ? -1 : 1) - (b.action === "decrease" ? -1 : 1) || b.spend - a.spend).slice(0, 30);
}
