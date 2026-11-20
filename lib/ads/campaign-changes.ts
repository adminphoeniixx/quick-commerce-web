// Approval and execution of AdCampaignChange rows (budget update / restart / stop) on Blinkit Ads.
// Blinkit refuses the write when the campaign's status or budget no longer matches what was approved.
import { prisma } from "@/lib/db";
import { BadRequest, Conflict, NotFound } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import type { AdsScope } from "./queries";

export const RESTART_DAYS = 14;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function listCampaignChanges(scope: AdsScope) {
  const rows = await prisma.adCampaignChange.findMany({ where: { brandId: scope.brandId, platformId: scope.platformId }, orderBy: { createdAt: "desc" }, take: 50 });
  return rows.map((r) => ({ id: r.id.toString(), campaignId: r.campaignId, campaignName: r.campaignName, kind: r.kind, expectedStatus: r.expectedStatus, expectedBudget: r.expectedBudget == null ? null : Number(r.expectedBudget), toBudget: r.toBudget == null ? null : Number(r.toBudget), status: r.status, reason: r.reason, growthPlanId: r.growthPlanId?.toString() ?? null, createdBy: r.createdBy, decidedBy: r.decidedBy, decidedAt: r.decidedAt, appliedAt: r.appliedAt, error: r.error, createdAt: r.createdAt }));
}

/** Blinkit action payload for a change; restart runs for RESTART_DAYS from today. */
export function campaignActionFor(change: { kind: string; campaignId: string; expectedStatus: string; expectedBudget: number | null; toBudget: number | null }, today = new Date()) {
  const base = { campaign_id: Number(change.campaignId), expected_status: change.expectedStatus, expected_budget: change.expectedBudget };
  if (change.kind === "stop") return { ...base, action: "stop" as const };
  if (change.toBudget == null || change.toBudget <= 0) throw BadRequest("Campaign change has no budget");
  if (change.kind === "update") return { ...base, action: "update" as const, budget: change.toBudget };
  if (change.kind === "restart") { const end = new Date(today); end.setUTCDate(end.getUTCDate() + RESTART_DAYS - 1); return { ...base, action: "restart" as const, budget: change.toBudget, start: iso(today), end: iso(end), no_end: false }; }
  throw BadRequest(`Unsupported campaign change ${change.kind}`);
}

export async function decideCampaignChange(scope: AdsScope, actor: { email: string; userId: bigint }, id: string, decision: "approve" | "reject") {
  if (!/^\d{1,20}$/.test(id)) throw NotFound("Campaign change not found");
  const change = await prisma.adCampaignChange.findFirst({ where: { id: BigInt(id), brandId: scope.brandId, platformId: scope.platformId } });
  if (!change) throw NotFound("Campaign change not found");
  if (change.status !== "PENDING" && !(decision === "approve" && change.status === "FAILED")) throw Conflict(`Change is already ${change.status.toLowerCase()}`);
  if (decision === "reject") {
    const res = await prisma.adCampaignChange.updateMany({ where: { id: change.id, status: "PENDING" }, data: { status: "REJECTED", decidedBy: actor.email, decidedAt: new Date() } });
    if (res.count !== 1) throw Conflict("Change was decided by someone else");
    await writeAudit({ userId: actor.userId, orgId: scope.orgId, action: "ads.campaign_change_rejected", target: change.id.toString() });
    return { id, status: "REJECTED" };
  }
  const connection = await prisma.platformConnection.findUnique({ where: { brandId_platformId: { brandId: scope.brandId, platformId: scope.platformId } } });
  if (!connection || connection.status !== "CONNECTED") throw BadRequest("Reconnect Blinkit Ads before changing campaigns");
  const action = campaignActionFor({ kind: change.kind, campaignId: change.campaignId, expectedStatus: change.expectedStatus, expectedBudget: change.expectedBudget == null ? null : Number(change.expectedBudget), toBudget: change.toBudget == null ? null : Number(change.toBudget) });
  const claimed = await prisma.adCampaignChange.updateMany({ where: { id: change.id, status: { in: ["PENDING", "FAILED"] } }, data: { status: "APPLYING", decidedBy: actor.email, decidedAt: new Date(), error: null } });
  if (claimed.count !== 1) throw Conflict("Change is already being processed");
  try {
    const { applyCampaignAction } = await import("@/lib/connections/browser");
    const result = await applyCampaignAction(connection.id, action);
    await prisma.adCampaign.updateMany({ where: { brandId: scope.brandId, platformId: scope.platformId, campaignId: change.campaignId }, data: { ...(result.after.status ? { status: result.after.status } : {}), ...(result.after.budget != null ? { budget: result.after.budget } : {}) } });
    await prisma.adCampaignChange.update({ where: { id: change.id }, data: { status: "APPLIED", appliedAt: new Date() } });
    await writeAudit({ userId: actor.userId, orgId: scope.orgId, action: `ads.campaign_change_${change.kind}_applied`, target: change.campaignId, meta: { changeId: id, before: result.before, after: result.after } });
    return { id, status: "APPLIED", after: result.after };
  } catch (error) {
    const message = (error instanceof Error ? error.message : "Campaign change failed").slice(0, 1000);
    await prisma.adCampaignChange.update({ where: { id: change.id }, data: { status: "FAILED", error: message } }).catch(() => undefined);
    throw error;
  }
}
