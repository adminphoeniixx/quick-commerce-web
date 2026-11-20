import { describe, expect, it } from "vitest";
import { campaignProposalKey } from "./campaign-proposal-key";

describe("campaignProposalKey", () => {
  it("is stable for the same launch identity", () => {
    const identity = { brandId: 2n, platformId: 1, templateId: "42", start: "2026-11-20", end: "2026-12-03", budget: 1400, dataAsOf: "2026-11-19", promptVersion: "campaign-v2" };
    expect(campaignProposalKey(identity)).toBe(campaignProposalKey({ ...identity }));
  });

  it("changes when a launch input changes", () => {
    const identity = { brandId: 2n, platformId: 1, templateId: "42", start: "2026-11-20", end: "2026-12-03", budget: 1400, dataAsOf: "2026-11-19", promptVersion: "campaign-v2" };
    expect(campaignProposalKey(identity)).not.toBe(campaignProposalKey({ ...identity, budget: 1500 }));
  });
});
