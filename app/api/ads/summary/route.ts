// Ad totals for dashboard widgets. brandId is optional (empty = every brand in the org).
import { handler, ok, BadRequest } from "@/lib/http";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { requirePermission, resolveOrgId } from "@/lib/rbac/authorize";
import { dateRange } from "@/lib/channels/queries";
import { adsSummary } from "@/lib/ads/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  const session = await requireSession(req);
  const orgId = resolveOrgId(session);
  await requirePermission(session, orgId, "sales:read");
  const url = new URL(req.url);
  const range = dateRange(url);
  if (!range) throw BadRequest("from and to are required");
  const raw = url.searchParams.get("brandId");
  let brandId: bigint | null = null;
  if (raw) {
    if (!/^\d+$/.test(raw)) throw BadRequest("Invalid brand");
    const brand = await prisma.brand.findFirst({ where: { id: BigInt(raw), orgId }, select: { id: true } });
    if (!brand) throw BadRequest("Brand not found");
    brandId = brand.id;
  }
  return ok(await adsSummary(orgId, brandId, range));
});
