// Idempotent visibility ingestion → VisibilityObservation (one row per
// org × platform × keyword × city × date × observedBrand; best rank kept).
import { prisma } from "@/lib/db";
import { Forbidden, NotFound } from "@/lib/http";
import type { PlatformSlug } from "@/lib/types";
import type { ImportSource } from "@prisma/client";
import type { NormalizedVisibilityRow, RowError } from "./contracts";
import { skuMap, makeCityResolver, makeKeywordResolver } from "./resolve";
import { createImportJob, finalizeImportJob, type CoreResult } from "./job";
import type { IngestResult } from "./ingestAvailability";

export interface VisCtx {
  orgId: bigint; brandId: bigint; platformSlug: PlatformSlug; source: ImportSource; fileName?: string;
}

function dedupe(rows: NormalizedVisibilityRow[]) {
  const map = new Map<string, NormalizedVisibilityRow>();
  let duplicates = 0;
  for (const r of rows) {
    const key = `${r.keyword}|${r.cityName}|${r.date}|${r.observedBrand.toLowerCase()}`;
    const existing = map.get(key);
    if (!existing) { map.set(key, r); continue; }
    duplicates++;
    if (r.rank < existing.rank) map.set(key, r);
  }
  return { merged: [...map.values()], duplicates };
}

export async function ingestVisibilityCore(
  ctx: VisCtx,
  parsed: { rows: NormalizedVisibilityRow[]; errors: RowError[] },
): Promise<CoreResult> {
  const brand = await prisma.brand.findUnique({ where: { id: ctx.brandId }, select: { orgId: true, name: true } });
  if (!brand) throw NotFound("Brand not found");
  if (brand.orgId !== ctx.orgId) throw Forbidden("Brand does not belong to this organization");
  const platform = await prisma.platform.findUnique({ where: { slug: ctx.platformSlug }, select: { id: true } });
  if (!platform) throw NotFound("Unknown platform");

  const { merged, duplicates } = dedupe(parsed.rows);
  const errors: RowError[] = [...parsed.errors];
  const ownSkus = new Set((await skuMap(ctx.brandId)).keys());
  // Marketplace product ids and storefront brand names synced from the seller panel also count as own.
  const channel = await prisma.channelProduct.findMany({
    where: { brandId: ctx.brandId, platformId: platform.id }, select: { productId: true, brandName: true, name: true },
  });
  for (const c of channel) if (c.productId) ownSkus.add(c.productId);
  const ownBrandNames = new Set([brand.name.toLowerCase(), ...channel.map((c) => c.brandName?.trim().toLowerCase()).filter((b): b is string => !!b)]);
  const keywordOf = makeKeywordResolver(ctx.brandId);
  const cityOf = makeCityResolver();
  let ok = 0;

  for (const row of merged) {
    try {
      const keywordId = await keywordOf(row.keyword);
      const cityId = await cityOf(row.cityName);
      const isOwn = ownBrandNames.has(row.observedBrand.toLowerCase()) || (!!row.skuCode && ownSkus.has(row.skuCode));
      await prisma.visibilityObservation.upsert({
        where: { orgId_platformId_keywordId_cityId_snapshotDate_observedBrand: {
          orgId: ctx.orgId, platformId: platform.id, keywordId, cityId, snapshotDate: new Date(row.date), observedBrand: row.observedBrand,
        } },
        create: { orgId: ctx.orgId, brandId: ctx.brandId, platformId: platform.id, keywordId, cityId, snapshotDate: new Date(row.date), observedBrand: row.observedBrand, skuCode: row.skuCode, rank: row.rank, page: row.page, isSponsored: row.isSponsored, isOwn },
        update: { rank: row.rank, page: row.page, isSponsored: row.isSponsored, isOwn, skuCode: row.skuCode },
      });
      ok++;
    } catch { errors.push({ row: 0, message: `Failed to write observation for "${row.keyword}"` }); }
  }
  return { rowsOk: ok, rowsFailed: errors.length, duplicatesMerged: duplicates, errors };
}

export async function ingestVisibility(
  ctx: VisCtx,
  parsed: { rows: NormalizedVisibilityRow[]; errors: RowError[] },
): Promise<IngestResult> {
  const job = await createImportJob({ ...ctx, dataType: "visibility", rowsTotal: parsed.rows.length });
  const res = await ingestVisibilityCore(ctx, parsed);
  await finalizeImportJob(job.id, res);
  return { importJobId: job.id, rowsTotal: parsed.rows.length, rowsOk: res.rowsOk, rowsFailed: res.rowsFailed, duplicatesMerged: res.duplicatesMerged };
}
