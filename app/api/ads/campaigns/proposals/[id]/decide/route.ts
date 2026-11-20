import { z } from "zod";
import { prisma } from "@/lib/db";
import { applyCampaignAction } from "@/lib/connections/browser";
import { adsScope } from "@/lib/ads/queries";
import { assertCsrf, requireSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac/authorize";
import { BadRequest, Conflict, handler, NotFound, ok, parseBody } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ action: z.enum(["approve", "reject"]) });

export const POST = handler(async (req, ctx: { params: { id: string } }) => {
  const session = await requireSession(req); assertCsrf(req);
  if (!/^\d{1,20}$/.test(ctx.params.id)) throw NotFound("Campaign proposal not found");
  const scope = await adsScope(req); await requirePermission(session, scope.orgId, "integration:manage");
  await rateLimit(`ads-campaign-proposal:${scope.orgId}:${session.userId}`, 20, 3600);
  const { action } = await parseBody(req, schema), id = BigInt(ctx.params.id);
  const proposal = await prisma.adCampaignProposal.findFirst({ where: { id, orgId: scope.orgId, brandId: scope.brandId, platformId: scope.platformId } });
  if (!proposal) throw NotFound("Campaign proposal not found");
  if (action === "reject") {
    if (proposal.status !== "PENDING_APPROVAL") throw Conflict(`Proposal is already ${proposal.status.toLowerCase()}`);
    await prisma.adCampaignProposal.update({ where: { id }, data: { status: "REJECTED", decidedBy: session.email, decidedAt: new Date() } });
    await writeAudit({ userId: session.userId, orgId: scope.orgId, action: "ads.campaign_proposal_rejected", target: id.toString() });
    return ok({ proposalId: id.toString(), status: "REJECTED" });
  }
  if (proposal.status === "APPLIED") return ok({ proposalId: id.toString(), status: proposal.status, campaignId: proposal.remoteCampaignId });
  if (proposal.status !== "PENDING_APPROVAL") throw Conflict(`Proposal is already ${proposal.status.toLowerCase()}`);
  const evidence = proposal.evidence as { launchReady?: boolean; source?: string; safetyPassed?: boolean }, consensus = proposal.agentReviews as { verdict?: string; reviews?: unknown[] };
  const manualDraft = evidence.source === "manual";
  const agentApproved = evidence.launchReady && consensus.verdict === "launch" && consensus.reviews?.length === 3;
  if (manualDraft ? !evidence.safetyPassed : !agentApproved) throw BadRequest("Proposal did not pass the required launch gates");
  if (Date.now() - proposal.dataAsOf.getTime() > 3 * 86400_000) throw BadRequest("Proposal evidence is stale; refresh campaign analysis");
  const [template, connection] = await Promise.all([
    prisma.adCampaign.findUnique({ where: { brandId_platformId_campaignId: { brandId: scope.brandId, platformId: scope.platformId, campaignId: proposal.templateCampaignId } } }),
    prisma.platformConnection.findUnique({ where: { brandId_platformId: { brandId: scope.brandId, platformId: scope.platformId } } }),
  ]);
  if (!template) throw NotFound("Template campaign not found");
  if (manualDraft && !["STOPPED", "COMPLETED"].includes(template.status)) throw BadRequest("Template campaign is no longer stopped; refresh before launch");
  if (!connection || connection.status !== "CONNECTED") throw BadRequest("Reconnect Blinkit Ads before launch");
  const forecast = proposal.forecast as { maximumSpend?: number };
  const wallet = await prisma.adAccountSnapshot.findFirst({ where: { brandId: scope.brandId, platformId: scope.platformId }, orderBy: { snapshotDate: "desc" } });
  const usableWallet = Number(wallet?.walletBalance ?? 0) + Number(wallet?.creditBalance ?? 0) - Number(wallet?.tentativeSpend ?? 0);
  if (!wallet || Date.now() - wallet.snapshotDate.getTime() > 3 * 86400_000) throw BadRequest("Wallet data is stale; sync Blinkit Ads before launch");
  if (!forecast.maximumSpend || usableWallet < forecast.maximumSpend) throw BadRequest("Available wallet and credit do not cover the proposal's maximum spend");
  if (!scope.sellerPlatformId) throw BadRequest("Blinkit Seller data is required for inventory safety checks");
  const products = await prisma.channelProduct.findMany({ where: { brandId: scope.brandId, platformId: scope.sellerPlatformId, productId: { in: template.productIds } }, select: { productId: true, itemId: true } });
  if (products.length !== template.productIds.length) throw BadRequest("Some campaign products are missing from the synced Seller catalogue");
  const latestInventory = await prisma.channelInventory.findFirst({ where: { brandId: scope.brandId, platformId: scope.sellerPlatformId }, orderBy: { snapshotDate: "desc" }, select: { snapshotDate: true } });
  if (!latestInventory || Date.now() - latestInventory.snapshotDate.getTime() > 3 * 86400_000) throw BadRequest("Inventory data is stale; sync Blinkit Seller before launch");
  const stock = await prisma.channelInventory.groupBy({ by: ["itemId"], where: { brandId: scope.brandId, platformId: scope.sellerPlatformId, snapshotDate: latestInventory.snapshotDate, itemId: { in: products.map((p) => p.itemId) } }, _sum: { totalSellable: true } });
  const sellable = new Map(stock.map((row) => [row.itemId, row._sum.totalSellable ?? 0]));
  if (products.some((product) => (sellable.get(product.itemId) ?? 0) <= 0)) throw BadRequest("One or more campaign products have no sellable inventory");
  const claimed = await prisma.adCampaignProposal.updateMany({ where: { id, status: "PENDING_APPROVAL" }, data: { status: "APPLYING", decidedBy: session.email, decidedAt: new Date(), error: null } });
  if (claimed.count !== 1) throw Conflict("Proposal is already being processed");
  let remoteCampaignId: string | null = null;
  try {
    const result = await applyCampaignAction(connection.id, { action: "duplicate", campaign_id: Number(template.campaignId), expected_status: template.status, expected_budget: template.budget == null ? null : Number(template.budget), name: proposal.name, budget: Number(proposal.budget), start: proposal.startAt.toISOString().slice(0, 10), end: proposal.endAt.toISOString().slice(0, 10), no_end: false });
    remoteCampaignId = result.campaignId;
    await prisma.adCampaignProposal.update({ where: { id }, data: { status: "REMOTE_CREATED", remoteCampaignId } });
    await prisma.adCampaign.upsert({ where: { brandId_platformId_campaignId: { brandId: scope.brandId, platformId: scope.platformId, campaignId: remoteCampaignId } }, create: {
      orgId: scope.orgId, brandId: scope.brandId, platformId: scope.platformId, campaignId: remoteCampaignId, name: result.after.name ?? proposal.name, campaignType: template.campaignType, objective: template.objective,
      status: result.after.status ?? "UNKNOWN", startAt: proposal.startAt, endAt: proposal.endAt, budget: result.after.budget, pacing: template.pacing, regionType: template.regionType, cities: template.cities, productIds: template.productIds, keywords: template.keywords ?? undefined, details: {},
    }, update: { name: result.after.name ?? proposal.name, status: result.after.status ?? "UNKNOWN", budget: result.after.budget, startAt: proposal.startAt, endAt: proposal.endAt } });
    await prisma.adCampaignProposal.update({ where: { id }, data: { status: "APPLIED" } });
    await writeAudit({ userId: session.userId, orgId: scope.orgId, action: "ads.campaign_proposal_applied", target: id.toString(), meta: { campaignId: remoteCampaignId, templateCampaignId: template.campaignId } });
    return ok({ proposalId: id.toString(), status: "APPLIED", campaignId: remoteCampaignId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Campaign launch failed";
    await prisma.adCampaignProposal.update({ where: { id }, data: { status: remoteCampaignId ? "RECONCILE_REQUIRED" : "FAILED", remoteCampaignId, error: message.slice(0, 1000) } }).catch(() => undefined);
    throw error;
  }
});
