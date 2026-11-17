import { prisma } from "@/lib/db";
import { handler, ok } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { requirePermission, resolveOrgId } from "@/lib/rbac/authorize";
import { platformCode } from "@/lib/marketplace/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  const session = await requireSession(req); const url = new URL(req.url);
  const organizationId = resolveOrgId(session, url.searchParams.get("orgId"));
  await requirePermission(session, organizationId, "product:read");
  const platform = platformCode.safeParse(url.searchParams.get("platform"));
  const keyword = url.searchParams.get("keyword")?.trim(); const city = url.searchParams.get("city")?.trim();
  const availability = url.searchParams.get("availability");
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1)); const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? 25)));
  const where = { organizationId, ...(platform.success ? { platform: platform.data } : {}), ...(keyword ? { OR: [{ title: { contains: keyword, mode: "insensitive" as const } }, { brand: { contains: keyword, mode: "insensitive" as const } }, { category: { contains: keyword, mode: "insensitive" as const } }] } : {}), ...(city ? { prices: { some: { city } } } : {}), ...(availability && ["IN_STOCK", "OUT_OF_STOCK", "UNKNOWN"].includes(availability) ? { availability: { some: { availabilityStatus: availability as "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN" } } } : {}) };
  const [total, products] = await prisma.$transaction([
    prisma.marketplaceProduct.count({ where }),
    prisma.marketplaceProduct.findMany({ where, orderBy: { lastObservedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { prices: { orderBy: { observedAt: "desc" }, take: 1 }, availability: { orderBy: { observedAt: "desc" }, take: 1 } } }),
  ]);
  return ok({ products: products.map(p => ({ ...p, currentPrice: p.prices[0] ?? null, currentAvailability: p.availability[0] ?? null, prices: undefined, availability: undefined })), pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) } });
});
