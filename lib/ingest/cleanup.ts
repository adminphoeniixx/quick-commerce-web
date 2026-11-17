import { unlink } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export async function cleanupExpiredImports(now = new Date()): Promise<{ inspected: number; deleted: number; failed: number }> {
  const jobs = await prisma.importJob.findMany({ where: { retentionUntil: { lt: now }, filePath: { not: null } }, select: { id: true, filePath: true }, take: 1000 });
  let deleted = 0, failed = 0;
  for (const job of jobs) {
    try {
      await unlink(job.filePath!).catch(e => { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; });
      await prisma.importJob.update({ where: { id: job.id }, data: { filePath: null } });
      deleted++;
    } catch (error) { failed++; logger.error("import.cleanup_failed", { importJobId: job.id, error }); }
  }
  logger.info("import.cleanup_complete", { inspected: jobs.length, deleted, failed });
  return { inspected: jobs.length, deleted, failed };
}
