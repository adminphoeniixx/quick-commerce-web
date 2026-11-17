// Parse + authorize the common analytics query filter.
import { prisma } from "@/lib/db";
import { Forbidden, NotFound } from "@/lib/http";
import { requirePermission, resolveOrgId } from "@/lib/rbac/authorize";
import type { Session } from "@/lib/auth/session";
import { resolvePlatformId, type Filter } from "./queries";

function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export async function analyticsFilter(req: Request, session: Session): Promise<Filter> {
  const url = new URL(req.url);
  const orgId = resolveOrgId(session, url.searchParams.get("orgId"));
  await requirePermission(session, orgId, "sales:read");

  let brandId: bigint | null = null;
  const brandRaw = url.searchParams.get("brandId");
  if (brandRaw) {
    try { brandId = BigInt(brandRaw); } catch { throw NotFound("Brand not found"); }
    const b = await prisma.brand.findUnique({ where: { id: brandId }, select: { orgId: true } });
    if (!b || b.orgId !== orgId) throw Forbidden("Brand does not belong to this organization");
  }

  const platformId = await resolvePlatformId(url.searchParams.get("platform"));
  let cityId: number | null = null;
  const cityRaw = url.searchParams.get("cityId");
  if (cityRaw) { cityId = Number(cityRaw); if (!Number.isInteger(cityId)) throw NotFound("City not found"); const city = await prisma.city.findUnique({ where: { id: cityId } }); if (!city) throw NotFound("City not found"); }
  const category = url.searchParams.get("category")?.trim() || null;

  const to = parseDate(url.searchParams.get("to")) ?? new Date();
  to.setHours(23, 59, 59, 999);
  const from = parseDate(url.searchParams.get("from")) ?? new Date(to.getTime() - 29 * 86400000);
  from.setHours(0, 0, 0, 0);

  return { orgId, brandId, platformId, cityId, category, from, to };
}
