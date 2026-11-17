// Dedicated BullMQ worker process. Run with: npm run worker
import { Worker } from "bullmq";
import { closeRedisConnection, redisConnection } from "@/lib/queue/connection";
import { QUEUE, MAX_ATTEMPTS, type ImportJobData, type AggregationJobData, type ScheduledJobData } from "@/lib/queue/queues";
import { processImportJob, processAggregation, processScheduledSync } from "@/lib/queue/processors";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { validateEnvironment } from "@/lib/env";
import { cleanupExpiredImports } from "@/lib/ingest/cleanup";
import { recoverSchedules } from "@/lib/connections/scheduler";
import { runBrowserSync } from "@/lib/connections/sync";
import { processBidApply } from "@/lib/ads/bids";

validateEnvironment();

const connection = redisConnection();
const importConcurrency = Number(process.env.IMPORT_CONCURRENCY ?? 4);

const importWorker = new Worker<ImportJobData>(
  QUEUE.IMPORT,
  async (job) => processImportJob(BigInt(job.data.importJobId)),
  { connection, concurrency: importConcurrency },
);

const aggWorker = new Worker<AggregationJobData>(
  QUEUE.AGGREGATION,
  async (job) => processAggregation(BigInt(job.data.orgId), BigInt(job.data.brandId)),
  { connection, concurrency: 2 },
);

const schedWorker = new Worker<ScheduledJobData>(
  QUEUE.SCHEDULED,
  async (job) => job.data.bidsBrandId
    ? processBidApply(BigInt(job.data.bidsOrgId!), BigInt(job.data.bidsBrandId), job.data.attempt ?? 0)
    : job.data.connectionId
    ? runBrowserSync(BigInt(job.data.connectionId), job.data.trigger ?? "manual", job.data.opts ?? (job.data.ranges ? { ranges: job.data.ranges, catalog: false } : {}))
    : processScheduledSync(BigInt(job.data.scheduleId!)),
  { connection, concurrency: 1 },
);

// Dead-letter handling: mark the ImportJob DEAD_LETTERED on the final failed attempt.
importWorker.on("failed", async (job, err) => {
  if (!job) return;
  const final = job.attemptsMade >= (job.opts.attempts ?? MAX_ATTEMPTS);
  try {
    await prisma.importJob.update({
      where: { id: BigInt(job.data.importJobId) },
      data: { status: final ? "DEAD_LETTERED" : "RETRY_SCHEDULED", attempts: job.attemptsMade, error: err.message.slice(0, 500) },
    });
  } catch { /* ignore */ }
  logger.error("worker.import_failed", { queueJobId: job.id, attemptsMade: job.attemptsMade, attempts: job.opts.attempts, error: err });
});
importWorker.on("completed", (job) => logger.info("worker.import_completed", { queueJobId: job.id }));
aggWorker.on("failed", (job, err) => logger.error("worker.aggregation_failed", { queueJobId: job?.id, error: err }));

for (const w of [importWorker, aggWorker, schedWorker]) {
  w.on("error", (e) => logger.error("worker.error", { error: e }));
}

logger.info("worker.ready", { importConcurrency, aggregationConcurrency: 2, scheduledConcurrency: 1 });
recoverSchedules().then((count) => logger.info("worker.schedules_recovered", { count })).catch((error) => logger.error("worker.schedule_recovery_failed", { error }));

const cleanupEveryMs = Number(process.env.IMPORT_CLEANUP_INTERVAL_MS ?? 6 * 60 * 60 * 1000);
const cleanupTimer = setInterval(() => cleanupExpiredImports().catch(error => logger.error("import.cleanup_unhandled", { error })), cleanupEveryMs);
cleanupTimer.unref();
cleanupExpiredImports().catch(error => logger.error("import.cleanup_unhandled", { error }));

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return; stopping = true;
  clearInterval(cleanupTimer);
  logger.info("worker.shutdown_started", { signal });
  const forceTimer = setTimeout(() => { logger.error("worker.shutdown_timeout", { signal }); process.exit(1); }, Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 30000));
  forceTimer.unref();
  await Promise.allSettled([importWorker.close(), aggWorker.close(), schedWorker.close()]);
  await prisma.$disconnect();
  await closeRedisConnection();
  clearTimeout(forceTimer);
  logger.info("worker.shutdown_complete", { signal });
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
