// Idempotent sales ingestion into fact tables. Re-running the same file updates
// rows in place (upsert by [listing, date]) instead of duplicating. Tenant-scoped.
import { prisma } from "@/lib/db";
import { Forbidden, NotFound } from "@/lib/http";
import type { PlatformSlug } from "@/lib/types";
import type { ImportSource } from "@prisma/client";
import type { NormalizedSalesRow, RowError } from "./contracts";
import { skuMap, makeListingResolver } from "./resolve";
import { createImportJob, finalizeImportJob, type CoreResult } from "./job";

export interface IngestContext {
  orgId: bigint; brandId: bigint; platformSlug: PlatformSlug; source: ImportSource; fileName?: string;
}
export interface IngestResult {
  importJobId: bigint; rowsTotal: number; rowsOk: number; rowsFailed: number; duplicatesMerged: number;
}

function dedupe(rows: NormalizedSalesRow[]): { merged: NormalizedSalesRow[]; duplicates: number } {
  const map = new Map<string, NormalizedSalesRow>();
  let duplicates = 0;
  for (const r of rows) {
    const key = `${r.skuCode}|${r.date}`;
    const existing = map.get(key);
    if (!existing) { map.set(key, { ...r }); continue; }
    duplicates++;
    existing.gmv += r.gmv;
    existing.unitsSold += r.unitsSold;
    if (r.avgSellPrice != null) existing.avgSellPrice = r.avgSellPrice;
    if (r.discountPct != null) existing.discountPct = r.discountPct;
    existing.productName ??= r.productName;
    existing.mrp ??= r.mrp;
    existing.category ??= r.category;
  }
  return { merged: [...map.values()], duplicates };
}

// Core: writes facts, returns counts. No job bookkeeping (caller owns the job).
export async function ingestSalesCore(
  ctx: IngestContext,
  parsed: { rows: NormalizedSalesRow[]; errors: RowError[] },
): Promise<CoreResult> {
  const brand = await prisma.brand.findUnique({ where: { id: ctx.brandId }, select: { orgId: true } });
  if (!brand) throw NotFound("Brand not found");
  if (brand.orgId !== ctx.orgId) throw Forbidden("Brand does not belong to this organization");
  const platform = await prisma.platform.findUnique({ where: { slug: ctx.platformSlug }, select: { id: true } });
  if (!platform) throw NotFound("Unknown platform");

  const { merged, duplicates } = dedupe(parsed.rows);
  const errors: RowError[] = [...parsed.errors];
  const codes = await skuMap(ctx.brandId);
  const listingOf = makeListingResolver(platform.id);
  let ok = 0;

  for (const row of merged) {
    let skuId = codes.get(row.skuCode);
    if (!skuId && row.productName) {
      // Order-level exports name the product: add it to the catalog instead of rejecting the row.
      const sku = await prisma.sku.upsert({
        where: { brandId_skuCode: { brandId: ctx.brandId, skuCode: row.skuCode } },
        create: { brandId: ctx.brandId, skuCode: row.skuCode, name: row.productName, mrp: row.mrp, category: row.category },
        update: {},
        select: { id: true },
      });
      skuId = sku.id;
      codes.set(row.skuCode, skuId);
    }
    if (!skuId) { errors.push({ row: 0, message: `Unknown SKU code: ${row.skuCode}` }); continue; }
    try {
      const listingId = await listingOf(skuId);
      await prisma.dailyMetric.upsert({
        where: { listingId_metricDate: { listingId, metricDate: new Date(row.date) } },
        create: { listingId, metricDate: new Date(row.date), gmv: row.gmv, unitsSold: row.unitsSold, avgSellPrice: row.avgSellPrice, discountPct: row.discountPct },
        update: { gmv: row.gmv, unitsSold: row.unitsSold, avgSellPrice: row.avgSellPrice, discountPct: row.discountPct },
      });
      ok++;
    } catch { errors.push({ row: 0, message: `Failed to write ${row.skuCode}@${row.date}` }); }
  }
  return { rowsOk: ok, rowsFailed: errors.length, duplicatesMerged: duplicates, errors };
}

// Synchronous wrapper (used for inline fallback and tests): owns the import job.
export async function ingestSales(
  ctx: IngestContext,
  parsed: { rows: NormalizedSalesRow[]; errors: RowError[] },
): Promise<IngestResult> {
  const job = await createImportJob({ ...ctx, dataType: "sales", rowsTotal: parsed.rows.length });
  const res = await ingestSalesCore(ctx, parsed);
  await finalizeImportJob(job.id, res);
  return { importJobId: job.id, rowsTotal: parsed.rows.length, rowsOk: res.rowsOk, rowsFailed: res.rowsFailed, duplicatesMerged: res.duplicatesMerged };
}
