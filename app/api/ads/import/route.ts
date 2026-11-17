// Push-import for Blinkit Ads payloads collected outside the browser service (the local
// agent MCP's blinkit_ads_sync). Same storage + ingest as a connector sync.
import { z } from "zod";
import { prisma } from "@/lib/db";
import { handler, ok, BadRequest, parseBody } from "@/lib/http";
import { requireSession, assertCsrf } from "@/lib/auth/session";
import { requirePermission, resolveOrgId } from "@/lib/rbac/authorize";
import { rateLimit } from "@/lib/ratelimit";
import { writeAudit } from "@/lib/audit";
import { AD_REPORT_TYPES } from "@/lib/ads/ingest";
import { importReports } from "@/lib/connections/sync";
import { ADS_PLATFORM } from "@/lib/ads/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  brandId: z.string().regex(/^\d+$/),
  reports: z.array(z.object({ type: z.enum(AD_REPORT_TYPES), data: z.record(z.string(), z.unknown()) })).min(1).max(8),
});

export const POST = handler(async (req) => {
  const session = await requireSession(req);
  assertCsrf(req);
  const orgId = resolveOrgId(session);
  await requirePermission(session, orgId, "integration:create");
  await rateLimit(`ads-import:${orgId}`, 20, 3600);
  const body = await parseBody(req, schema);
  const [brand, platform] = await Promise.all([
    prisma.brand.findFirst({ where: { id: BigInt(body.brandId), orgId }, select: { id: true } }),
    prisma.platform.findUnique({ where: { slug: ADS_PLATFORM }, select: { id: true } }),
  ]);
  if (!brand || !platform) throw BadRequest("Invalid brand, or Blinkit Ads is not set up");
  const results = await importReports({ orgId, brandId: brand.id, platformId: platform.id },
    body.reports.map((r) => ({ type: r.type, range: null, status: "ok" as const, fileName: `${r.type}.json`, data: Buffer.from(JSON.stringify(r.data)).toString("base64") })),
    "manual");
  await writeAudit({ userId: session.userId, orgId, action: "ads.imported", target: brand.id.toString(), meta: { reports: body.reports.map((r) => r.type) } });
  return ok({ results });
});
