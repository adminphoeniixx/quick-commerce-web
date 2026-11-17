import { z } from "zod";
import { prisma } from "@/lib/db";
import { handler, ok, NotFound, parseBody } from "@/lib/http";
import { requireSession, assertCsrf } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac/authorize";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
async function owned(req: Request, raw: string, write = false) {
  const s = await requireSession(req); let id: bigint;
  try { id = BigInt(raw); } catch { throw NotFound("Template not found"); }
  const t = await prisma.importMappingTemplate.findUnique({ where: { id } });
  if (!t) throw NotFound("Template not found");
  await requirePermission(s, t.orgId, write ? "integration:create" : "integration:read"); return { s, t };
}
export const PATCH = handler(async (req, ctx: { params: { id: string } }) => {
  assertCsrf(req); const { t } = await owned(req, ctx.params.id, true);
  const b = await parseBody(req, z.object({ name: z.string().trim().min(1).max(80).optional(), mapping: z.record(z.string(), z.string()).optional(), isDefault: z.boolean().optional() }));
  const result = await prisma.$transaction(async tx => {
    if (b.isDefault) await tx.importMappingTemplate.updateMany({ where: { orgId: t.orgId, platformSlug: t.platformSlug, dataType: t.dataType }, data: { isDefault: false } });
    return tx.importMappingTemplate.update({ where: { id: t.id }, data: { name: b.name, mappingJson: b.mapping, isDefault: b.isDefault } });
  });
  return ok({ template: result });
});
export const DELETE = handler(async (req, ctx: { params: { id: string } }) => {
  assertCsrf(req); const { t } = await owned(req, ctx.params.id, true);
  await prisma.importMappingTemplate.delete({ where: { id: t.id } }); return ok({ deleted: true });
});
