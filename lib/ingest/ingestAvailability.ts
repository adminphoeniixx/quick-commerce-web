// Idempotent availability ingestion → AvailabilitySnapshot (listing × city × date).
// Snapshots are point-in-time, so duplicates within a file are last-wins.
import { prisma } from "@/lib/db";
import { Forbidden, NotFound } from "@/lib/http";
import type { PlatformSlug } from "@/lib/types";
import type { ImportSource } from "@prisma/client";
import type { NormalizedAvailabilityRow, RowError } from "./contracts";
import { skuMap, makeListingResolver, makeCityResolver } from "./resolve";
import { createImportJob, finalizeImportJob, type CoreResult } from "./job";
import { dedupeLast } from "./dedupe";

export interface AvailCtx {
  orgId: bigint; brandId: bigint; platformSlug: PlatformSlug; source: ImportSource; fileName?: string;
}
export interface IngestResult {
  importJobId: bigint; rowsTotal: number; rowsOk: number; rowsFailed: number; duplicatesMerged: number;
}

export async function ingestAvailabilityCore(
  ctx: AvailCtx,
  parsed: { rows: NormalizedAvailabilityRow[]; errors: RowError[] },
): Promise<CoreResult> {
  const brand = await prisma.brand.findUnique({ where: { id: ctx.brandId }, select: { orgId: true } });
  if (!brand) throw NotFound("Brand not found");
  if (brand.orgId !== ctx.orgId) throw Forbidden("Brand does not belong to this organization");
  const platform = await prisma.platform.findUnique({ where: { slug: ctx.platformSlug }, select: { id: true } });
  if (!platform) throw NotFound("Unknown platform");

  const { merged, duplicates } = dedupeLast(parsed.rows, (r) => `${r.skuCode}|${r.cityName}|${r.date}`);
  const errors: RowError[] = [...parsed.errors];
  const codes = await skuMap(ctx.brandId);
  const listingOf = makeListingResolver(platform.id);
  const cityOf = makeCityResolver();
  let ok = 0;

  for (const row of merged) {
    const skuId = codes.get(row.skuCode);
    if (!skuId) { errors.push({ row: 0, message: `Unknown SKU code: ${row.skuCode}` }); continue; }
    try {
      const listingId = await listingOf(skuId);
      const cityId = await cityOf(row.cityName);
      const availabilityPct = Math.round((100 * row.storesInStock / row.storesTotal) * 100) / 100;
      const isOos = row.storesInStock === 0;
      await prisma.availabilitySnapshot.upsert({
        where: { listingId_cityId_snapshotDate: { listingId, cityId, snapshotDate: new Date(row.date) } },
        create: { listingId, cityId, snapshotDate: new Date(row.date), storesTotal: row.storesTotal, storesInStock: row.storesInStock, availabilityPct, isOos },
        update: { storesTotal: row.storesTotal, storesInStock: row.storesInStock, availabilityPct, isOos },
      });
      ok++;
    } catch { errors.push({ row: 0, message: `Failed to write ${row.skuCode}@${row.cityName}` }); }
  }
  return { rowsOk: ok, rowsFailed: errors.length, duplicatesMerged: duplicates, errors };
}

export async function ingestAvailability(
  ctx: AvailCtx,
  parsed: { rows: NormalizedAvailabilityRow[]; errors: RowError[] },
): Promise<IngestResult> {
  const job = await createImportJob({ ...ctx, dataType: "availability", rowsTotal: parsed.rows.length });
  const res = await ingestAvailabilityCore(ctx, parsed);
  await finalizeImportJob(job.id, res);
  return { importJobId: job.id, rowsTotal: parsed.rows.length, rowsOk: res.rowsOk, rowsFailed: res.rowsFailed, duplicatesMerged: res.duplicatesMerged };
}
