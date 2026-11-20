import { z } from "zod";
import { prisma } from "@/lib/db";
import { adsScope } from "@/lib/ads/queries";
import { assertCsrf, requireSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac/authorize";
import { handler, ok, parseBody } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  targetSalesGrowthPct: z.number().min(1).max(200),
  maxDailyAdSpend: z.number().positive().max(10_000_000),
  minimumRoas: z.number().min(0.1).max(100),
  horizonDays: z.number().int().min(7).max(90),
  autopilot: z.boolean().default(false),
  replanEveryDays: z.number().int().min(1).max(30).default(7),
  notifyEmail: z.string().email().max(254).nullish(),
});

export const GET = handler(async (req) => {
  const session = await requireSession(req), scope = await adsScope(req);
  await requirePermission(session, scope.orgId, "integration:read");
  return ok({ goal: await prisma.salesGrowthGoal.findFirst({ where: { orgId: scope.orgId, brandId: scope.brandId, active: true }, orderBy: { createdAt: "desc" } }) });
});

// Goals are versioned: a new row replaces the active one so researched plans keep the goal they were built for.
export const POST = handler(async (req) => {
  const session = await requireSession(req); assertCsrf(req);
  const scope = await adsScope(req); await requirePermission(session, scope.orgId, "integration:manage");
  await rateLimit(`ads-growth-goal:${scope.orgId}:${session.userId}`, 20, 3600);
  const body = await parseBody(req, schema);
  const goal = await prisma.$transaction(async (tx) => {
    await tx.salesGrowthGoal.updateMany({ where: { orgId: scope.orgId, brandId: scope.brandId, active: true }, data: { active: false } });
    return tx.salesGrowthGoal.create({ data: { orgId: scope.orgId, brandId: scope.brandId, ...body, notifyEmail: body.notifyEmail ?? null, createdBy: session.email } });
  });
  await writeAudit({ userId: session.userId, orgId: scope.orgId, action: "ads.growth_goal_created", target: goal.id.toString(), meta: { ...body, notifyEmail: body.notifyEmail ? "set" : null } });
  return ok({ goal });
});
