import { prisma } from "@/lib/db";
import { handler, ok } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { requirePermission, resolveOrgId } from "@/lib/rbac/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Audit events for the active org (requires audit:read). Paginated.
export const GET = handler(async (req) => {
  const session = await requireSession(req);
  const url = new URL(req.url);
  const orgId = resolveOrgId(session, url.searchParams.get("orgId"));
  await requirePermission(session, orgId, "audit:read");

  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("page_size") ?? 25)));

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, action: true, userId: true, target: true, meta: true, createdAt: true },
    }),
    prisma.auditLog.count({ where: { orgId } }),
  ]);

  return ok({
    results: items,
    meta: { total_items: total, page, page_size: pageSize, total_pages: Math.ceil(total / pageSize) },
  });
});
