// Push-import for the Blinkit Seller Hub listing / SEO payload collected by the local agent
// MCP's blinkit_seller_seo_sync (services/browser/blinkit_seller_seo.py).
import { z } from "zod";
import { prisma } from "@/lib/db";
import { handler, ok, BadRequest, parseBody } from "@/lib/http";
import { requireSession, assertCsrf } from "@/lib/auth/session";
import { requirePermission, resolveOrgId } from "@/lib/rbac/authorize";
import { rateLimit } from "@/lib/ratelimit";
import { writeAudit } from "@/lib/audit";
import { ingestListingSeo } from "@/lib/seo/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  brandId: z.string().regex(/^\d+$/),
  payload: z.object({
    expansion: z.array(z.record(z.string(), z.unknown())).max(2000),
    products: z.record(z.string(), z.unknown()),
  }).passthrough(),
});

export const POST = handler(async (req) => {
  const session = await requireSession(req);
  assertCsrf(req);
  const orgId = resolveOrgId(session);
  await requirePermission(session, orgId, "integration:create");
  await rateLimit(`seo-import:${orgId}`, 20, 3600);
  const body = await parseBody(req, schema);
  const [brand, platform] = await Promise.all([
    prisma.brand.findFirst({ where: { id: BigInt(body.brandId), orgId }, select: { id: true } }),
    prisma.platform.findUnique({ where: { slug: "blinkit" }, select: { id: true } }),
  ]);
  if (!brand || !platform) throw BadRequest("Invalid brand, or the Blinkit platform is missing");
  const result = await ingestListingSeo({ orgId, brandId: brand.id, platformId: platform.id }, body.payload as Record<string, unknown>);
  await writeAudit({ userId: session.userId, orgId, action: "seo.imported", target: brand.id.toString(), meta: result });
  return ok(result);
});
