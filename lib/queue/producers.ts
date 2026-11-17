// Enqueue helpers. Import jobs use a deterministic jobId for duplicate protection.
import { importQueue, aggregationQueue, scheduledQueue } from "./queues";

export async function enqueueImport(importJobId: bigint): Promise<string> {
  const jobId = `import-${importJobId}`;
  await importQueue().add("process-import", { importJobId: importJobId.toString() }, { jobId });
  return jobId;
}

export async function enqueueAggregation(orgId: bigint, brandId: bigint): Promise<void> {
  await aggregationQueue().add("aggregate", { orgId: orgId.toString(), brandId: brandId.toString() });
}

export async function enqueueScheduled(scheduleId: bigint): Promise<void> {
  await scheduledQueue().add("scheduled-sync", { scheduleId: scheduleId.toString() });
}
