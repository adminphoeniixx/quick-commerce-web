// Import-job bookkeeping shared by the synchronous wrappers and the async worker.
import { prisma } from "@/lib/db";
import type { ImportSource } from "@prisma/client";
import type { DataType, RowError } from "./contracts";

export interface CoreResult {
  rowsOk: number;
  rowsFailed: number;
  duplicatesMerged: number;
  errors: RowError[];
}

export async function createImportJob(args: {
  orgId: bigint; brandId: bigint; source: ImportSource; dataType: DataType;
  platformSlug?: string; fileName?: string; rowsTotal?: number;
}) {
  return prisma.importJob.create({
    data: {
      orgId: args.orgId, brandId: args.brandId, source: args.source, dataType: args.dataType,
      platformSlug: args.platformSlug, fileName: args.fileName,
      status: "RUNNING", startedAt: new Date(), rowsTotal: args.rowsTotal ?? 0,
    },
  });
}

export async function finalizeImportJob(jobId: bigint, r: CoreResult) {
  if (r.errors.length) {
    await prisma.importError.createMany({
      data: r.errors.slice(0, 1000).map((e) => ({ importJobId: jobId, rowNumber: e.row || null, message: e.message, errorCode: "INVALID_ROW" })),
    });
  }
  await prisma.importJob.update({
    where: { id: jobId },
    data: {
      status: r.errors.length && r.rowsOk === 0 ? "FAILED" : "SUCCESS",
      finishedAt: new Date(), progress: 100,
      rowsOk: r.rowsOk, rowsFailed: r.rowsFailed, duplicates: r.duplicatesMerged,
      error: r.errors.length && r.rowsOk === 0 ? r.errors[0]?.message?.slice(0, 500) : null,
    },
  });
}
