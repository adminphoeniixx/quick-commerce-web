import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { adsScope } from "@/lib/ads/queries";
import { assertCsrf, requireSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac/authorize";
import { BadRequest, Conflict, handler, NotFound, ok, parseBody } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  templateCampaignId: z.string().regex(/^\d{1,20}$/),
  name: z.string().trim().min(1).max(160),
  budget: z.number().positive().max(100_000_000),
  start: z.string().date(),
  end: z.string().date(),
}).superRefine((value, ctx) => {
  const start = new Date(`${value.start}T00:00:00Z`), end = new Date(`${value.end}T00:00:00Z`);
  const days = Math.floor((end.getTime() - start.getTime()) / 86400_000) + 1;
  if (days < 1 || days > 30) ctx.addIssue({ code: "custom", path: ["end"], message: "Campaign duration must be between 1 and 30 days" });
});

export const POST = handler(async (req) => {
  const session = await requireSession(req); assertCsrf(req);
  const scope = await adsScope(req); await requirePermission(session, scope.orgId, "integration:manage");
  await rateLimit(`ads-campaign-proposal-create:${scope.orgId}:${session.userId}`, 20, 3600);
  const body = await parseBody(req, schema);
  const template = await prisma.adCampaign.findUnique({ where: { brandId_platformId_campaignId: { brandId: scope.brandId, platformId: scope.platformId, campaignId: body.templateCampaignId } } });
  if (!template) throw NotFound("Template campaign not found");
  if (!["STOPPED", "COMPLETED"].includes(template.status)) throw BadRequest("Choose a stopped or completed campaign to avoid overlapping auctions and duplicate spend");
  if (!template.productIds.length) throw BadRequest("Template campaign has no products");
  const duplicate = await prisma.adCampaign.findFirst({ where: { brandId: scope.brandId, platformId: scope.platformId, name: body.name } });
  if (duplicate) throw Conflict("A campaign with this name already exists");

  const startAt = new Date(`${body.start}T00:00:00Z`), endAt = new Date(`${body.end}T00:00:00Z`);
  const days = Math.floor((endAt.getTime() - startAt.getTime()) / 86400_000) + 1;
  const payload = JSON.stringify({ ...body, expectedStatus: template.status, expectedBudget: template.budget == null ? null : Number(template.budget) });
  const payloadHash = createHash("sha256").update(payload).digest("hex");
  const idempotencyKey = `manual:${scope.brandId}:${scope.platformId}:${payloadHash}`;
  const proposal = await prisma.adCampaignProposal.upsert({
    where: { orgId_idempotencyKey: { orgId: scope.orgId, idempotencyKey } },
    create: {
      orgId: scope.orgId, brandId: scope.brandId, platformId: scope.platformId,
      templateCampaignId: template.campaignId, name: body.name, budget: body.budget,
      startAt, endAt,
      evidence: { source: "manual", safetyPassed: true, templateStatus: template.status, productCount: template.productIds.length },
      forecast: { maximumSpend: body.budget * days, durationDays: days },
      agentReviews: { verdict: "human_approval_required", reviews: [] },
      dataAsOf: new Date(), model: null, promptVersion: "manual-campaign-v1",
      idempotencyKey, payloadHash, createdBy: session.email,
    },
    update: {},
  });
  await writeAudit({ userId: session.userId, orgId: scope.orgId, action: "ads.campaign_proposal_created", target: proposal.id.toString(), meta: { source: "manual", templateCampaignId: template.campaignId } });
  return ok({ proposalId: proposal.id.toString(), status: proposal.status });
});
