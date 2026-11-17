// Downloads the original file of a synced seller-panel report.
import { prisma } from "@/lib/db";
import { handler, NotFound } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req, ctx: { params: { id: string } }) => {
  const session = await requireSession(req);
  let id: bigint;
  try { id = BigInt(ctx.params.id); } catch { throw NotFound("Report not found"); }
  const r = await prisma.channelReport.findUnique({ where: { id }, select: { orgId: true, fileName: true, fileData: true } });
  if (!r || !r.fileData) throw NotFound("Report file not found");
  await requirePermission(session, r.orgId, "report:read");
  const name = (r.fileName || `report-${id}.xlsx`).replace(/[^\w.\-]+/g, "_");
  return new Response(r.fileData, {
    headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
  });
});
