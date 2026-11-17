// Queue definitions + default job options (retry/backoff).
import { Queue } from "bullmq";
import { redisConnection } from "./connection";

export const QUEUE = {
  IMPORT: "qcp-import",
  AGGREGATION: "qcp-aggregation",
  SCHEDULED: "qcp-scheduled",
} as const;

export const MAX_ATTEMPTS = Number(process.env.JOB_MAX_ATTEMPTS ?? 3);

export const defaultJobOpts = {
  attempts: MAX_ATTEMPTS,
  backoff: { type: "exponential" as const, delay: Number(process.env.JOB_BACKOFF_MS ?? 2000) },
  removeOnComplete: { count: 1000 },
  removeOnFail: false, // keep failed jobs for dead-letter inspection
};

const cache = new Map<string, Queue>();
function queue(name: string): Queue {
  let q = cache.get(name);
  if (!q) { q = new Queue(name, { connection: redisConnection(), defaultJobOptions: defaultJobOpts }); cache.set(name, q); }
  return q;
}

export const importQueue = () => queue(QUEUE.IMPORT);
export const aggregationQueue = () => queue(QUEUE.AGGREGATION);
export const scheduledQueue = () => queue(QUEUE.SCHEDULED);

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([...cache.values()].map(q => q.close()));
  cache.clear();
}

export interface ImportJobData { importJobId: string; }
export interface AggregationJobData { orgId: string; brandId: string; }
// "scheduled-sync" jobs carry scheduleId; one-off "connection-sync" jobs carry connectionId.
// "ads-bids" jobs carry bidsOrgId + bidsBrandId: apply the brand's approved Blinkit Ads bid changes.
export interface ScheduledJobData { bidsOrgId?: string; bidsBrandId?: string; attempt?: number; scheduleId?: string; connectionId?: string; trigger?: "manual" | "connect" | "retry"; ranges?: string[]; opts?: import("@/lib/connections/browser").SyncOptions; }
