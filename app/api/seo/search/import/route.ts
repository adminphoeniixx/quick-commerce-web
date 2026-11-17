// Push-import of blinkit.com search results for Blinkit Ads keywords, read by the local agent
// MCP's blinkit_keyword_rank in the user's own Chrome.
import { z } from "zod";
import { prisma } from "@/lib/db";
import { handler, ok, BadRequest, parseBody } from "@/lib/http";
import { requireSession, assertCsrf } from "@/lib/auth/session";
import { requirePermission, resolveOrgId } from "@/lib/rbac/authorize";
import { rateLimit } from "@/lib/ratelimit";
import { writeAudit } from "@/lib/audit";
import { ingestSearch } from "@/lib/seo/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  brandId: z.string().regex(/^\d+$/),
  payload: z.object({
    city: z.string().min(1).max(80), location: z.string().max(300).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    results: z.array(z.object({ keyword: z.string().min(1).max(120), products: z.array(z.record(z.string(), z.unknown())).max(100) })).min(1).max(20),
  }),
});

export const POST = handler(async (req) => {
  const session = await requireSession(req);
  assertCsrf(req);
  const orgId = resolveOrgId(session);
  await requirePermission(session, orgId, "integration:create");
  await rateLimit(`search-import:${orgId}`, 20, 3600);
  const body = await parseBody(req, schema);
  const [brand, platform] = await Promise.all([
    prisma.brand.findFirst({ where: { id: BigInt(body.brandId), orgId }, select: { id: true } }),
    prisma.platform.findUnique({ where: { slug: "blinkit" }, select: { id: true } }),
  ]);
  if (!brand || !platform) throw BadRequest("Invalid brand, or the Blinkit platform is missing");
  const result = await ingestSearch({ orgId, brandId: brand.id, platformId: platform.id }, body.payload);
  await writeAudit({ userId: session.userId, orgId, action: "seo.search_imported", target: brand.id.toString(), meta: result });
  return ok(result);
});
