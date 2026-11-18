// Idempotent pricing ingestion → PricingSnapshot (listing × city × date).
import { prisma } from "@/lib/db";
import { Forbidden, NotFound } from "@/lib/http";
import type { PlatformSlug } from "@/lib/types";
import type { ImportSource } from "@prisma/client";
import type { NormalizedPricingRow, RowError } from "./contracts";
import { skuMap, makeListingResolver, makeCityResolver } from "./resolve";
import { createImportJob, finalizeImportJob, type CoreResult } from "./job";
import type { IngestResult } from "./ingestAvailability";
import { dedupeLast } from "./dedupe";

export interface PriceCtx {
  orgId: bigint; brandId: bigint; platformSlug: PlatformSlug; source: ImportSource; fileName?: string;
}

export async function ingestPricingCore(
  ctx: PriceCtx,
  parsed: { rows: NormalizedPricingRow[]; errors: RowError[] },
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
      await prisma.pricingSnapshot.upsert({
        where: { listingId_cityId_snapshotDate: { listingId, cityId, snapshotDate: new Date(row.date) } },
        create: { listingId, cityId, snapshotDate: new Date(row.date), sellingPrice: row.sellingPrice, mrp: row.mrp, discountPct: row.discountPct },
        update: { sellingPrice: row.sellingPrice, mrp: row.mrp, discountPct: row.discountPct },
      });
      ok++;
    } catch { errors.push({ row: 0, message: `Failed to write ${row.skuCode}@${row.cityName}` }); }
  }
  return { rowsOk: ok, rowsFailed: errors.length, duplicatesMerged: duplicates, errors };
}

export async function ingestPricing(
  ctx: PriceCtx,
  parsed: { rows: NormalizedPricingRow[]; errors: RowError[] },
): Promise<IngestResult> {
  const job = await createImportJob({ ...ctx, dataType: "pricing", rowsTotal: parsed.rows.length });
  const res = await ingestPricingCore(ctx, parsed);
  await finalizeImportJob(job.id, res);
  return { importJobId: job.id, rowsTotal: parsed.rows.length, rowsOk: res.rowsOk, rowsFailed: res.rowsFailed, duplicatesMerged: res.duplicatesMerged };
}
