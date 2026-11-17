import { prisma } from "@/lib/db";
import { handler, ok, NotFound } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Import job detail + its row-level errors. Scoped to the job's own org.
export const GET = handler(async (req, ctx: { params: { id: string } }) => {
  const session = await requireSession(req);
  let id: bigint;
  try { id = BigInt(ctx.params.id); } catch { throw NotFound("Import not found"); }

  const job = await prisma.importJob.findUnique({ where: { id } });
  if (!job) throw NotFound("Import not found");
  await requirePermission(session, job.orgId, "integration:read"); // tenant + permission

  const errors = await prisma.importError.findMany({
    where: { importJobId: id }, take: 200,
    select: { rowNumber: true, message: true },
  });
  return ok({ job, errors });
});
