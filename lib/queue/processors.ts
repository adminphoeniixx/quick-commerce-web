// Job processors — pure async functions callable by the worker and by tests.
import { readFile, unlink } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { parseTabularSheet } from "@/lib/ingest/parse";
import {
  getAdapter, getAvailabilityAdapter, getPricingAdapter, getVisibilityAdapter, getProductAdapter,
} from "@/lib/ingest/adapters";
import { ingestSalesCore } from "@/lib/ingest/ingestSales";
import { ingestAvailabilityCore } from "@/lib/ingest/ingestAvailability";
import { ingestPricingCore } from "@/lib/ingest/ingestPricing";
import { ingestVisibilityCore } from "@/lib/ingest/ingestVisibility";
import { ingestProductsCore } from "@/lib/ingest/ingestProducts";
import { finalizeImportJob } from "@/lib/ingest/job";
import { aggregateBrand } from "@/lib/analytics/aggregate";
import type { PlatformSlug } from "@/lib/types";
import type { DataType } from "@/lib/ingest/contracts";
import { parseMapped, type ColumnMapping } from "@/lib/ingest/mapping";

async function setProgress(jobId: bigint, progress: number, patch: object = {}) {
  await prisma.importJob.update({ where: { id: jobId }, data: { progress, ...patch } });
}

export interface ProcessSummary { importJobId: string; skipped?: boolean; rowsOk?: number; rowsFailed?: number; }

export async function processImportJob(importJobId: bigint): Promise<ProcessSummary> {
  const job = await prisma.importJob.findUnique({ where: { id: importJobId } });
  if (!job) throw new Error(`ImportJob ${importJobId} not found`);
  if (job.status === "SUCCESS") return { importJobId: importJobId.toString(), skipped: true }; // idempotent
  if (!job.brandId || !job.platformSlug || !job.filePath) throw new Error("ImportJob missing brand/platform/file");

  await setProgress(importJobId, 10, { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 } });

  const buffer = await readFile(job.filePath);
  const raw = (await parseTabularSheet(buffer, job.selectedSheet || undefined)).rows;
  await setProgress(importJobId, 40);

  const ctx = { orgId: job.orgId, brandId: job.brandId, platformSlug: job.platformSlug as PlatformSlug, source: job.source, fileName: job.fileName ?? undefined };
  const dataType = job.dataType as DataType;

  const parsed = job.mappingJson
    ? parseMapped(raw, job.mappingJson as ColumnMapping, dataType, ctx.platformSlug)
    : dataType === "availability" ? getAvailabilityAdapter(ctx.platformSlug).parse(raw)
      : dataType === "pricing" ? getPricingAdapter(ctx.platformSlug).parse(raw)
        : dataType === "visibility" ? getVisibilityAdapter(ctx.platformSlug).parse(raw)
          : dataType === "products" ? getProductAdapter(ctx.platformSlug).parse(raw)
            : getAdapter(ctx.platformSlug).parse(raw);
  let res;
  if (dataType === "availability") res = await ingestAvailabilityCore(ctx, parsed as ReturnType<ReturnType<typeof getAvailabilityAdapter>["parse"]>);
  else if (dataType === "pricing") res = await ingestPricingCore(ctx, parsed as ReturnType<ReturnType<typeof getPricingAdapter>["parse"]>);
  else if (dataType === "visibility") res = await ingestVisibilityCore(ctx, parsed as ReturnType<ReturnType<typeof getVisibilityAdapter>["parse"]>);
  else if (dataType === "products") res = await ingestProductsCore(ctx, parsed as ReturnType<ReturnType<typeof getProductAdapter>["parse"]>);
  else res = await ingestSalesCore(ctx, parsed as ReturnType<ReturnType<typeof getAdapter>["parse"]>);

  await setProgress(importJobId, 80);
  await finalizeImportJob(importJobId, res);

  // Aggregation runs here in the worker (off the HTTP path). Idempotent recompute.
  if (res.rowsOk > 0 && dataType !== "pricing" && dataType !== "products") await aggregateBrand(job.orgId, job.brandId);

  // Wizard uploads are retained for the bounded retry window. Legacy uploads
  // have no retention marker and keep the previous delete-after-processing policy.
  if (!job.retentionUntil) await unlink(job.filePath).catch(() => {});

  return { importJobId: importJobId.toString(), rowsOk: res.rowsOk, rowsFailed: res.rowsFailed };
}

export async function processAggregation(orgId: bigint, brandId: bigint): Promise<number> {
  return aggregateBrand(orgId, brandId);
}

// Scheduled sync: browser-connector platforms download their report with the saved
// session; everything else stays blocked until an authorized connector exists.
export async function processScheduledSync(scheduleId: bigint): Promise<string> {
  const s = await prisma.syncSchedule.findUnique({ where: { id: scheduleId } });
  if (!s || !s.enabled) return "skipped";
  const now = new Date();
  if (s.brandId && s.platformId) {
    const conn = await prisma.platformConnection.findUnique({
      where: { brandId_platformId: { brandId: s.brandId, platformId: s.platformId } }, include: { platform: true },
    });
    const { browserSupported } = await import("@/lib/connections/browser");
    if (conn && browserSupported(conn.platform.slug)) {
      if (s.dataType === "auth_health") {
        // Same rules as the 15-minute keep-alive (lib/connections/keepalive.ts).
        const { checkAndRecord } = await import("@/lib/connections/keepalive");
        const fresh = await prisma.platformConnection.findUniqueOrThrow({ where: { id: conn.id }, select: { id: true, orgId: true, brandId: true, status: true, authFailures: true, platform: { select: { slug: true, name: true } }, brand: { select: { name: true } } } });
        const status = await checkAndRecord(fresh);
        await prisma.syncSchedule.update({ where: { id: scheduleId }, data: { lastRunAt: now, lastStatus: status } });
        return status;
      }
      const { runBrowserSync } = await import("@/lib/connections/sync");
      let result: string;
      try { result = await runBrowserSync(conn.id, "scheduled"); } catch (e) { result = `error: ${e instanceof Error ? e.message : e}`; }
      await prisma.syncSchedule.update({ where: { id: scheduleId }, data: { lastRunAt: now, lastStatus: result.slice(0, 200) } });
      return result;
    }
  }
  const status = "blocked: no authorized connector configured";
  await prisma.$transaction([
    prisma.syncSchedule.update({ where: { id: scheduleId }, data: { lastRunAt: now, lastStatus: status } }),
    prisma.syncJob.create({ data: { orgId: s.orgId, platformId: s.platformId, jobType: `scheduled_${s.dataType}`, status: "FAILED", startedAt: now, finishedAt: now, error: status } }),
  ]);
  return status;
}
