import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { HAS_DB } from "../setup";

// Point BullMQ at Redis before the queue modules initialise their connection.
process.env.REDIS_URL ||= "redis://localhost:6379";

import { prisma } from "@/lib/db";
import { processImportJob } from "@/lib/queue/processors";
import { enqueueImport } from "@/lib/queue/producers";
import { importQueue, defaultJobOpts } from "@/lib/queue/queues";
import { cleanupExpiredImports } from "@/lib/ingest/cleanup";

// Redis integration tests are opt-in: a developer's production-like .env can
// point at a Docker-only hostname which is intentionally unreachable from the host.
// CI/local integration runs enable this explicitly with RUN_REDIS_TESTS=1.
const HAS_REDIS = process.env.RUN_REDIS_TESTS === "1";

let orgId: bigint, brandId: bigint;
const tmpFiles: string[] = [];

async function stageCsv(content: string): Promise<string> {
  const p = path.join(os.tmpdir(), `qcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
  await writeFile(p, content);
  tmpFiles.push(p);
  return p;
}

beforeAll(async () => {
  if (!HAS_DB) return;
  await prisma.platform.upsert({ where: { slug: "blinkit" }, create: { slug: "blinkit", name: "Blinkit" }, update: {} });
  const org = await prisma.organization.create({ data: { name: `QOrg ${Date.now()}` } });
  orgId = org.id;
  const brand = await prisma.brand.create({ data: { orgId, name: "QBrand" } });
  brandId = brand.id;
  await prisma.sku.createMany({ data: [{ brandId, name: "A", skuCode: "CF-A" }] });
});

afterAll(async () => {
  if (!HAS_DB) return;
  await prisma.analyticsDaily.deleteMany({ where: { orgId } });
  await prisma.importJob.deleteMany({ where: { orgId } });
  await prisma.brand.deleteMany({ where: { orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.$disconnect();
});

describe.skipIf(!HAS_DB)("async import processor", () => {
  it("processes a staged file end-to-end, aggregates, and cleans up", async () => {
    const filePath = await stageCsv("SKU Code,Date,GMV,Units Sold\nCF-A,2026-10-01,1000,10\n");
    const job = await prisma.importJob.create({
      data: { orgId, brandId, source: "CSV", dataType: "sales", platformSlug: "blinkit", fileName: "t.csv", filePath, status: "QUEUED", rowsTotal: 1 },
    });

    const summary = await processImportJob(job.id);
    expect(summary.rowsOk).toBe(1);

    const done = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe("SUCCESS");
    expect(done.progress).toBe(100);

    // facts + rollup written
    const metrics = await prisma.dailyMetric.count({ where: { listing: { sku: { brandId } } } });
    expect(metrics).toBe(1);
    const roll = await prisma.analyticsDaily.aggregate({ _sum: { gmv: true }, where: { orgId, brandId } });
    expect(Number(roll._sum.gmv)).toBe(1000);

    // staged file removed
    await expect(access(filePath)).rejects.toThrow();
  });

  it("is idempotent: re-processing a SUCCESS job is skipped", async () => {
    const filePath = await stageCsv("SKU Code,Date,GMV,Units Sold\nCF-A,2026-10-02,500,5\n");
    const job = await prisma.importJob.create({
      data: { orgId, brandId, source: "CSV", dataType: "sales", platformSlug: "blinkit", filePath, status: "QUEUED", rowsTotal: 1 },
    });
    await processImportJob(job.id);
    const second = await processImportJob(job.id);
    expect(second.skipped).toBe(true);
  });
});

describe.skipIf(!HAS_REDIS)("BullMQ queue (real Redis)", () => {
  it("retains failed jobs with bounded retry/backoff for crash recovery", () => {
    expect(defaultJobOpts.attempts).toBeGreaterThanOrEqual(2);
    expect(defaultJobOpts.backoff.type).toBe("exponential");
    expect(defaultJobOpts.backoff.delay).toBeGreaterThan(0);
    expect(defaultJobOpts.removeOnFail).toBe(false);
  });
  it("enqueues with a deterministic jobId (duplicate-protected)", async () => {
    const q = importQueue();
    const fakeId = BigInt(Date.now());
    await q.remove(`import-${fakeId}`).catch(() => {});
    await enqueueImport(fakeId);
    await enqueueImport(fakeId); // duplicate — same jobId, ignored
    const job = await q.getJob(`import-${fakeId}`);
    expect(job).toBeTruthy();
    expect(job!.data.importJobId).toBe(fakeId.toString());
    await q.remove(`import-${fakeId}`).catch(() => {});
    await q.close();
  });
});

describe.skipIf(!HAS_DB)("staged-file retention cleanup", () => {
  it("deletes expired files and clears the persisted path", async () => {
    const filePath = await stageCsv("expired");
    const job = await prisma.importJob.create({ data: { orgId, brandId, source: "CSV", dataType: "sales", platformSlug: "blinkit", filePath, status: "FAILED", retentionUntil: new Date(Date.now() - 1000) } });
    const result = await cleanupExpiredImports();
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    await expect(access(filePath)).rejects.toThrow();
    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } })).filePath).toBeNull();
  });
});
