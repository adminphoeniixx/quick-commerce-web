export interface CampaignTemplate {
  campaignId: string;
  name: string;
  type: string;
  status: string;
  budget: number | null;
  endAt: string | null;
  productIds: string[];
}

export interface ManagedCampaign {
  campaignId: string;
  name: string;
  status: string;
  budget: number | null;
  startAt: string | null;
  endAt: string | null;
}

export type CampaignAction = "stop" | "restart" | "update" | "duplicate";

export interface CampaignActionResult {
  action: CampaignAction;
  campaignId: string;
  sourceCampaignId?: string;
  before: { status: string | null; budget: number | null; name: string | null };
  after: { status: string | null; budget: number | null; name: string | null };
  note?: string;
}
