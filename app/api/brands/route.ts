import { z } from "zod";
import { prisma } from "@/lib/db";
import { handler, ok, parseBody } from "@/lib/http";
import { requireSession, assertCsrf } from "@/lib/auth/session";
import { requirePermission, resolveOrgId } from "@/lib/rbac/authorize";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  const session = await requireSession(req);
  const orgId = resolveOrgId(session, new URL(req.url).searchParams.get("orgId"));
  await requirePermission(session, orgId, "brand:read");
  const brands = await prisma.brand.findMany({
    where: { orgId },
    select: { id: true, name: true, category: true, _count: { select: { skus: true } } },
    orderBy: { id: "asc" },
  });
  return ok({ brands });
});

const createSchema = z.object({ name: z.string().min(2).max(120), category: z.string().max(80).optional() });

export const POST = handler(async (req) => {
  const session = await requireSession(req);
  assertCsrf(req);
  const orgId = resolveOrgId(session);
  await requirePermission(session, orgId, "brand:create");
  const { name, category } = await parseBody(req, createSchema);
  const brand = await prisma.brand.create({ data: { orgId, name, category } });
  await writeAudit({ userId: session.userId, orgId, action: "brand.created", target: name });
  return ok({ id: brand.id, name: brand.name, category: brand.category }, { status: 201 });
});
