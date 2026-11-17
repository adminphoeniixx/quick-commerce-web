import { prisma } from "@/lib/db";
import { handler, ok, parseBody, Unauthorized } from "@/lib/http";
import { authorizedObservationBatch, normalizeProductTitle } from "@/lib/marketplace/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Machine-to-machine endpoint for feeds whose collection rights have been reviewed.
// Consumer marketplace credentials are never accepted here.
export const POST = handler(async (req) => {
  const expected = process.env.AUTHORIZED_FEED_INGEST_TOKEN;
  const supplied = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied || expected.length !== supplied.length || supplied !== expected) throw Unauthorized("Invalid feed credential");
  const body = await parseBody(req, authorizedObservationBatch);
  const organizationId = BigInt(body.organizationId);
  const organization = await prisma.organization.findFirst({ where: { id: organizationId, deletedAt: null }, select: { id: true } });
  if (!organization) throw Unauthorized("Feed is not authorized for this organization");

  const summary = await prisma.$transaction(async (tx) => {
    const run = await tx.scrapingRun.create({ data: { organizationId, platform: body.platform, status: "RUNNING", collectionType: body.collectionType, keyword: body.keyword, city: body.city, locationKey: body.locationKey, startedAt: new Date() } });
    let insertedCount = 0; let updatedCount = 0;
    for (const item of body.observations) {
      const existing = await tx.marketplaceProduct.findUnique({ where: { organizationId_platform_platformProductId: { organizationId, platform: body.platform, platformProductId: item.platformProductId } }, select: { id: true } });
      const product = await tx.marketplaceProduct.upsert({
        where: { organizationId_platform_platformProductId: { organizationId, platform: body.platform, platformProductId: item.platformProductId } },
        create: { organizationId, platform: body.platform, platformProductId: item.platformProductId, productUrl: item.productUrl, title: item.title, normalizedTitle: normalizeProductTitle(item.title), brand: item.brand, category: item.category, subcategory: item.subcategory, imageUrl: item.imageUrl, packSize: item.packSize, unit: item.unit, lastObservedAt: new Date(item.observedAt) },
        update: { productUrl: item.productUrl, title: item.title, normalizedTitle: normalizeProductTitle(item.title), brand: item.brand, category: item.category, subcategory: item.subcategory, imageUrl: item.imageUrl, packSize: item.packSize, unit: item.unit, lastObservedAt: new Date(item.observedAt) },
      });
      existing ? updatedCount++ : insertedCount++;
      const discountPct = item.mrp && item.mrp > 0 ? Math.max(0, ((item.mrp - item.sellingPrice) / item.mrp) * 100) : null;
      await tx.productPriceObservation.create({ data: { organizationId, productId: product.id, platform: body.platform, city: body.city, locationKey: body.locationKey, mrp: item.mrp, sellingPrice: item.sellingPrice, discountPct, observedAt: new Date(item.observedAt), sourceUrl: item.sourceUrl, collectionRunId: run.id } });
      await tx.productAvailabilityObservation.create({ data: { organizationId, productId: product.id, platform: body.platform, city: body.city, locationKey: body.locationKey, availabilityStatus: item.availability, observedAt: new Date(item.observedAt), sourceUrl: item.sourceUrl, collectionRunId: run.id } });
      if (body.keyword && item.rank) await tx.productRankingObservation.create({ data: { organizationId, productId: product.id, keyword: body.keyword, platform: body.platform, locationKey: body.locationKey, rank: item.rank, placementType: item.placementType ?? "UNKNOWN", observedAt: new Date(item.observedAt), collectionRunId: run.id } });
    }
    await tx.scrapingRun.update({ where: { id: run.id }, data: { status: "SUCCESS", completedAt: new Date(), discoveredCount: body.observations.length, insertedCount, updatedCount } });
    return { runId: run.id, discoveredCount: body.observations.length, insertedCount, updatedCount };
  });
  return ok(summary, { status: 201 });
});
