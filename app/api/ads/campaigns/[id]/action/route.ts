import { z } from "zod";
import { prisma } from "@/lib/db";
import { handler, ok, NotFound, BadRequest, parseBody } from "@/lib/http";
import { assertCsrf, requireSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac/authorize";
import { rateLimit } from "@/lib/ratelimit";
import { writeAudit } from "@/lib/audit";
import { adsScope } from "@/lib/ads/queries";
import { applyCampaignAction } from "@/lib/connections/browser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.enum(["stop", "restart", "update", "duplicate"]),
  expectedStatus: z.string().max(40),
  expectedBudget: z.number().nonnegative().nullable(),
  name: z.string().trim().min(1).max(160).optional(),
  budget: z.number().positive().max(100_000_000).optional(),
  start: z.string().date().optional(),
  end: z.string().date().optional(),
  noEnd: z.boolean().optional(),
}).superRefine((v, ctx) => {
  if (["restart", "update", "duplicate"].includes(v.action) && v.budget == null)
    ctx.addIssue({ code: "custom", path: ["budget"], message: "Budget is required" });
  if (v.action === "duplicate" && !v.name)
    ctx.addIssue({ code: "custom", path: ["name"], message: "New campaign name is required" });
  if (v.noEnd === false && !v.end && ["restart", "duplicate"].includes(v.action))
    ctx.addIssue({ code: "custom", path: ["end"], message: "End date is required" });
});

export const POST = handler(async (req, ctx: { params: { id: string } }) => {
  const session = await requireSession(req);
  assertCsrf(req);
  if (!/^\d{1,20}$/.test(ctx.params.id)) throw NotFound("Campaign not found");
  const scope = await adsScope(req);
  await requirePermission(session, scope.orgId, "integration:manage");
  const body = await parseBody(req, schema);
  if (body.action === "duplicate") throw BadRequest("Create campaigns through the durable proposal approval flow");
  await rateLimit(`ads-campaign-action:${scope.orgId}:${session.userId}`, 20, 3600);

  const [campaign, connection] = await Promise.all([
    prisma.adCampaign.findUnique({ where: { brandId_platformId_campaignId: { brandId: scope.brandId, platformId: scope.platformId, campaignId: ctx.params.id } } }),
    prisma.platformConnection.findUnique({ where: { brandId_platformId: { brandId: scope.brandId, platformId: scope.platformId } } }),
  ]);
  if (!campaign) throw NotFound("Campaign not found");
  if (!connection || connection.status !== "CONNECTED") throw BadRequest("Connect Blinkit Ads before changing campaigns");

  const result = await applyCampaignAction(connection.id, {
    action: body.action, campaign_id: Number(campaign.campaignId),
    expected_status: body.expectedStatus, expected_budget: body.expectedBudget,
    name: body.name, budget: body.budget, start: body.start, end: body.end, no_end: body.noEnd,
  });

  await prisma.adCampaign.update({ where: { id: campaign.id }, data: {
    status: result.after.status ?? campaign.status,
    budget: result.after.budget ?? campaign.budget,
    name: result.after.name ?? campaign.name,
    ...(body.start ? { startAt: new Date(body.start) } : {}),
    ...(body.noEnd === true ? { endAt: null } : body.end ? { endAt: new Date(body.end) } : {}),
  } });
  await writeAudit({ userId: session.userId, orgId: scope.orgId, action: `ads.campaign_${body.action}`, target: result.campaignId, meta: { sourceCampaignId: campaign.campaignId, before: result.before, after: result.after } });
  return ok(result);
});
