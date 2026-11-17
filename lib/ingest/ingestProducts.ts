// Idempotent product-catalog ingestion → Sku (brand × skuCode) + PlatformListing (sku × platform).
import { prisma } from "@/lib/db";
import { Forbidden, NotFound } from "@/lib/http";
import type { PlatformSlug } from "@/lib/types";
import type { ImportSource } from "@prisma/client";
import type { NormalizedProductRow, RowError } from "./contracts";
import type { CoreResult } from "./job";

export interface ProductCtx {
  orgId: bigint; brandId: bigint; platformSlug: PlatformSlug; source: ImportSource; fileName?: string;
}

function dedupe(rows: NormalizedProductRow[]) {
  const map = new Map<string, NormalizedProductRow>();
  let duplicates = 0;
  for (const r of rows) {
    if (map.has(r.skuCode)) duplicates++;
    map.set(r.skuCode, r);
  }
  return { merged: [...map.values()], duplicates };
}

export async function ingestProductsCore(
  ctx: ProductCtx,
  parsed: { rows: NormalizedProductRow[]; errors: RowError[] },
): Promise<CoreResult> {
  const brand = await prisma.brand.findUnique({ where: { id: ctx.brandId }, select: { orgId: true } });
  if (!brand) throw NotFound("Brand not found");
  if (brand.orgId !== ctx.orgId) throw Forbidden("Brand does not belong to this organization");
  const platform = await prisma.platform.findUnique({ where: { slug: ctx.platformSlug }, select: { id: true } });
  if (!platform) throw NotFound("Unknown platform");

  const { merged, duplicates } = dedupe(parsed.rows);
  const errors: RowError[] = [...parsed.errors];
  let ok = 0;

  for (const row of merged) {
    try {
      // Only overwrite optional attributes when the export actually has them.
      const attrs = {
        name: row.name,
        ...(row.packSize !== undefined ? { packSize: row.packSize } : {}),
        ...(row.mrp !== undefined ? { mrp: row.mrp } : {}),
        ...(row.category !== undefined ? { category: row.category } : {}),
      };
      const sku = await prisma.sku.upsert({
        where: { brandId_skuCode: { brandId: ctx.brandId, skuCode: row.skuCode } },
        create: { brandId: ctx.brandId, skuCode: row.skuCode, ...attrs },
        update: attrs,
        select: { id: true },
      });
      await prisma.platformListing.upsert({
        where: { skuId_platformId: { skuId: sku.id, platformId: platform.id } },
        create: { skuId: sku.id, platformId: platform.id, platformProductId: row.platformProductId },
        update: row.platformProductId ? { platformProductId: row.platformProductId } : {},
      });
      ok++;
    } catch {
      errors.push({ row: 0, message: `Failed to write product ${row.skuCode}` });
    }
  }
  return { rowsOk: ok, rowsFailed: errors.length, duplicatesMerged: duplicates, errors };
}
