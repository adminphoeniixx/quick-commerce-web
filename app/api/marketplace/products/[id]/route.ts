import { prisma } from "@/lib/db";
import { handler, ok, NotFound } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { requirePermission, resolveOrgId } from "@/lib/rbac/authorize";

export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export const GET = handler(async (req, ctx) => {
  const session = await requireSession(req); const organizationId = resolveOrgId(session, new URL(req.url).searchParams.get("orgId"));
  await requirePermission(session, organizationId, "product:read");
  let id: bigint; try { id = BigInt(ctx.params.id); } catch { throw NotFound("Product not found"); }
  const product = await prisma.marketplaceProduct.findFirst({ where: { id, organizationId }, include: { prices: { orderBy: { observedAt: "desc" }, take: 365 }, availability: { orderBy: { observedAt: "desc" }, take: 365 }, rankings: { orderBy: { observedAt: "desc" }, take: 365 } } });
  if (!product) throw NotFound("Product not found"); return ok({ product });
});
