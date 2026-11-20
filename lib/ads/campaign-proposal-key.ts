import { createHash } from "node:crypto";

interface CampaignProposalIdentity {
  brandId: bigint;
  platformId: number;
  templateId: string;
  start: string;
  end: string;
  budget: number;
  dataAsOf: string;
  promptVersion: string;
}

/** Stable across agent wording changes so repeated analysis cannot create duplicate proposals. */
export function campaignProposalKey(identity: CampaignProposalIdentity) {
  const hash = createHash("sha256").update(JSON.stringify({ ...identity, brandId: identity.brandId.toString() })).digest("hex");
  return `campaign:${hash}`;
}
