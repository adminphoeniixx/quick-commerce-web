import { describe, expect, it } from "vitest";
import { normalizeCampaignAgentResponse } from "./campaign-analysis-agents";
import { normalizeBidAgentResponse } from "./bid-analysis-agents";

describe("agent response normalization", () => {
  it("bounds campaign lists and text without rejecting the response", () => {
    const [review] = normalizeCampaignAgentResponse({ reviews: [{ id: "1", verdict: "review", summary: "s".repeat(600), drivers: Array(7).fill("d".repeat(250)), risks: Array(8).fill("r".repeat(250)) }] });
    expect(review.summary).toHaveLength(500);
    expect(review.drivers).toHaveLength(5);
    expect(review.risks).toHaveLength(5);
    expect(review.drivers[0]).toHaveLength(220);
  });

  it("bounds bid risks without rejecting the response", () => {
    const [review] = normalizeBidAgentResponse({ reviews: [{ id: "1", verdict: "approve", summary: "s".repeat(500), risks: Array(6).fill("r".repeat(200)) }] });
    expect(review.summary).toHaveLength(400);
    expect(review.risks).toHaveLength(4);
    expect(review.risks[0]).toHaveLength(180);
  });

  it("keeps valid reviews when another review is malformed", () => {
    const reviews = normalizeCampaignAgentResponse({ reviews: [{ id: "bad" }, { id: "good", verdict: "launch", summary: "Ready", drivers: [], risks: [] }] });
    expect(reviews.map((review) => review.id)).toEqual(["good"]);
  });
});
