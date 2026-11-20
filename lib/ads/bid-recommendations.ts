export interface BidRecommendationInput {
  campaignId: string; campaignName: string; campaignStatus: string; keyword: string; matchType: string;
  cpm: number | null; hasOpenChange: boolean; impressions: number; spend: number; sales: number; atc: number; position: number | null; roas: number | null;
  research?: BidResearch;
  pastOutcomes?: import("./growth-learning").PastOutcome[];
  marketInsight?: import("./market-learning").MarketInsight | null;
}

export interface BidResearch {
  roas7d: number | null; ownSearchRank: number | null; organicRank: number | null;
  availabilityPct: number | null; sellableUnits: number | null; ownPrice: number | null;
  competitorMedianPrice: number | null; previousBid: string | null; dataWarnings: string[];
}

export interface BidAgentReview { role: string; verdict: "approve" | "review" | "skip"; summary: string; risks: string[] }
export interface BidRecommendation extends BidRecommendationInput {
  id: string; toCpm: number; changePct: number; action: "increase" | "decrease"; objective: string; reason: string;
  confidence: "medium" | "high"; expectedImpact: string; decisionFactors: string[]; agentConsensus?: { verdict: "approve" | "review" | "skip"; summary: string; reviews: BidAgentReview[] };
}

const round10 = (value: number) => Math.round(value / 10) * 10;

/** Deterministic bounds own every number. AI may review and explain, never set a bid. */
export function recommendBids(rows: BidRecommendationInput[], limits = { min: 50, max: 2000 }): BidRecommendation[] {
  return rows.flatMap((row) => {
    if (row.campaignStatus !== "ACTIVE" || row.cpm == null || row.hasOpenChange || row.spend < 500) return [];
    const roas = row.roas ?? 0, research = row.research;
    const effectiveRank = research?.ownSearchRank ?? row.position;
    let changePct = 0, objective = "", reason = "", confidence: "medium" | "high" = "medium";
    const slot = effectiveRank == null ? "Ranking unavailable" : `${research?.ownSearchRank != null ? "Search rank" : "Avg slot"} ${effectiveRank.toFixed(1)}`;
    if (row.sales === 0 && row.spend >= 1000) { changePct = -15; objective = "Reduce wasted spend"; reason = `₹${Math.round(row.spend).toLocaleString("en-IN")} spend produced no attributed sales. ${slot}.`; confidence = "high"; }
    else if (roas < 1) {
      // Preserve more auction coverage when the keyword already has weak placement.
      changePct = effectiveRank != null && effectiveRank > 3 ? -5 : -10;
      objective = "Protect margin";
      reason = `${roas.toFixed(2)}x ROAS is below ad-spend break-even before product cost. ${slot}${effectiveRank != null && effectiveRank > 3 ? " is weak, so the reduction is limited to 5%." : " supports a controlled 10% reduction."}`;
    }
    else if (roas >= 3 && row.impressions >= 1000 && row.sales >= 1500) {
      // A keyword already winning a top-two slot needs less extra auction pressure.
      if (research?.sellableUnits === 0 || (research?.availabilityPct != null && research.availabilityPct < 50) || (research?.roas7d != null && research.roas7d < 1)) return [];
      changePct = effectiveRank != null && effectiveRank <= 2 ? 5 : 10;
      objective = "Capture more sales";
      reason = `${roas.toFixed(2)}x ROAS has enough impressions and attributed sales. ${slot}${effectiveRank != null && effectiveRank <= 2 ? " is already strong, so growth is limited to 5%." : " leaves room for a controlled 10% increase."}`;
      confidence = row.spend >= 1500 ? "high" : "medium";
    }
    if (!changePct) return [];
    const toCpm = Math.max(limits.min, Math.min(limits.max, round10(row.cpm * (1 + changePct / 100))));
    if (toCpm === row.cpm) return [];
    const actualPct = ((toCpm - row.cpm) / row.cpm) * 100;
    const expectedImpact = changePct > 0
      ? `Auction ceiling rises ${Math.abs(actualPct).toFixed(0)}%. Eligible impressions may increase; CPM and spend may also rise. Sales lift is not guaranteed.`
      : `Auction ceiling falls ${Math.abs(actualPct).toFixed(0)}%. CPM and spend exposure may fall; impressions and attributed sales may also decline.`;
    const decisionFactors = [
      `${row.impressions.toLocaleString("en-IN")} impressions`,
      `₹${Math.round(row.spend).toLocaleString("en-IN")} spend`,
      `₹${Math.round(row.sales).toLocaleString("en-IN")} attributed sales`,
      `${roas.toFixed(2)}x ROAS`,
      slot,
      ...(research?.roas7d != null ? [`7-day ROAS ${research.roas7d.toFixed(2)}x`] : []),
      ...(research?.availabilityPct != null ? [`Availability ${research.availabilityPct.toFixed(0)}%`] : []),
      ...(research?.sellableUnits != null ? [`${research.sellableUnits.toLocaleString("en-IN")} sellable units`] : []),
      ...(research?.organicRank != null ? [`Organic rank ${research.organicRank}`] : []),
      ...(research?.ownPrice != null && research.competitorMedianPrice != null ? [`Price ₹${research.ownPrice} vs competitor median ₹${research.competitorMedianPrice}`] : []),
      ...(research?.previousBid ? [research.previousBid] : []),
    ];
    const rollbackPlan = changePct > 0
      ? "Rollback if 7-day ROAS falls below 1.0x, availability falls below 50%, or spend rises without attributed sales."
      : "Rollback if search rank or impressions fall materially while ROAS remains at or above the previous level.";
    return [{ ...row, id: `${row.campaignId}|${row.keyword.toLowerCase()}|${row.matchType}`, toCpm, changePct: actualPct, action: changePct > 0 ? "increase" as const : "decrease" as const, objective, reason, confidence, expectedImpact: `${expectedImpact} ${rollbackPlan}`, decisionFactors }];
  }).sort((a, b) => (a.action === "decrease" ? -1 : 1) - (b.action === "decrease" ? -1 : 1) || b.spend - a.spend).slice(0, 30);
}
