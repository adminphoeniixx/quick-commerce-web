import { access } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { handler, ok, NotFound, BadRequest } from "@/lib/http";
import { requireSession, assertCsrf } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac/authorize";
import { requireVerifiedEmail } from "@/lib/auth/verified";
import { queuesEnabled } from "@/lib/queue/connection";
import { importQueue } from "@/lib/queue/queues";
import { enqueueImport } from "@/lib/queue/producers";
import { processImportJob } from "@/lib/queue/processors";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Re-run a failed / dead-lettered import. Privileged: re-authorized every time.
export const POST = handler(async (req, ctx: { params: { id: string } }) => {
  const session = await requireSession(req);
  assertCsrf(req);
  await requireVerifiedEmail(session);
  let id: bigint;
  try { id = BigInt(ctx.params.id); } catch { throw NotFound("Import not found"); }

  const job = await prisma.importJob.findUnique({ where: { id } });
  if (!job) throw NotFound("Import not found");
  await requirePermission(session, job.orgId, "integration:create"); // tenant + permission re-check

  if (!["FAILED", "DEAD_LETTERED"].includes(job.status)) throw BadRequest("Only failed imports can be retried");
  if (!job.filePath) throw BadRequest("Original file is no longer available for retry");
  try { await access(job.filePath); } catch { throw BadRequest("Original file is no longer available for retry"); }

  await prisma.importJob.update({ where: { id }, data: { status: "QUEUED", progress: 0, error: null, finishedAt: null } });
  await writeAudit({ userId: session.userId, orgId: job.orgId, action: "import.retry", target: id.toString() });

  if (queuesEnabled()) {
    await importQueue().remove(`import:${id}`).catch(() => {}); // clear the old job id
    const queueJobId = await enqueueImport(id);
    await prisma.importJob.update({ where: { id }, data: { queueJobId } });
    return ok({ importJobId: id, status: "QUEUED", async: true }, { status: 202 });
  }
  const summary = await processImportJob(id);
  return ok({ async: false, ...summary });
});
