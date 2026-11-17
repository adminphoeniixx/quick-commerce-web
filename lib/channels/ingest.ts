// Writes parsed seller-panel data into QCP: catalog → Sku/PlatformListing/ChannelProduct,
// order lines → ChannelOrder, then rebuilds DailyMetric for the covered dates from the
// order lines so dashboard sales always equal the sum of orders.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { CatalogProduct, OrderLine, StockLine } from "./blinkit";
import { makeCityResolver } from "@/lib/ingest/resolve";

export interface ChannelCtx { orgId: bigint; brandId: bigint; platformId: number }

// Orders in these states are kept in the order list but excluded from sales.
export const NOT_SOLD_STATUS = "cancel|return|rto|refund|fail|undeliver";
const NATIONAL = "National";

const dec = (v: number | undefined) => (v == null ? undefined : new Prisma.Decimal(v));

async function upsertSku(ctx: ChannelCtx, code: string, attrs: { name: string; mrp?: number; packSize?: string; category?: string }, overwrite: boolean) {
  const data = {
    name: attrs.name,
    ...(attrs.mrp != null ? { mrp: attrs.mrp } : {}),
    ...(attrs.packSize ? { packSize: attrs.packSize } : {}),
    ...(attrs.category ? { category: attrs.category } : {}),
  };
  const sku = await prisma.sku.upsert({
    where: { brandId_skuCode: { brandId: ctx.brandId, skuCode: code } },
    create: { brandId: ctx.brandId, skuCode: code, ...data },
    update: overwrite ? data : {},
    select: { id: true },
  });
  return sku.id;
}

const discount = (sp: number, mrp?: number | null) => (mrp && mrp > 0 && sp <= mrp ? Math.round((1 - sp / mrp) * 1000) / 10 : null);

export async function ingestCatalog(ctx: ChannelCtx, products: CatalogProduct[]): Promise<number> {
  const cityOf = makeCityResolver();
  const national = () => cityOf(NATIONAL);
  let n = 0;
  for (const p of products) {
    // The catalog is the source of truth for product attributes.
    const skuId = await upsertSku(ctx, p.itemId, { name: p.name, mrp: p.mrp, packSize: p.uom, category: p.businessCategory }, true);
    const listing = await prisma.platformListing.upsert({
      where: { skuId_platformId: { skuId, platformId: ctx.platformId } },
      create: { skuId, platformId: ctx.platformId, platformProductId: p.productId },
      update: p.productId ? { platformProductId: p.productId } : {},
      select: { id: true },
    });
    if (p.sellingPrice != null) {
      // Current listed price, recorded as a "National" observation for today.
      const cityId = await national();
      const snapshotDate = new Date(new Date().toISOString().slice(0, 10));
      const price = { sellingPrice: p.sellingPrice, mrp: p.mrp ?? null, discountPct: discount(p.sellingPrice, p.mrp) };
      await prisma.pricingSnapshot.upsert({
        where: { listingId_cityId_snapshotDate: { listingId: listing.id, cityId, snapshotDate } },
        create: { listingId: listing.id, cityId, snapshotDate, ...price }, update: price,
      });
    }
    const data = {
      skuId, productId: p.productId, upc: p.upc, name: p.name, brandName: p.brandName, uom: p.uom,
      mrp: dec(p.mrp), sellingPrice: dec(p.sellingPrice), status: p.status, businessCategory: p.businessCategory,
      manufacturer: p.manufacturer, hsn: p.hsn, gstPct: dec(p.gstPct), commissionPct: dec(p.commissionPct),
      commissionValue: dec(p.commissionValue), fulfillmentFee: dec(p.fulfillmentFee), details: p.details as Prisma.InputJsonValue,
    };
    await prisma.channelProduct.upsert({
      where: { brandId_platformId_itemId: { brandId: ctx.brandId, platformId: ctx.platformId, itemId: p.itemId } },
      create: { orgId: ctx.orgId, brandId: ctx.brandId, platformId: ctx.platformId, itemId: p.itemId, ...data },
      update: data,
    });
    n++;
  }
  return n;
}

export async function ingestOrders(ctx: ChannelCtx, lines: OrderLine[], reportId: bigint): Promise<{ imported: number; from?: string; to?: string }> {
  if (!lines.length) return { imported: 0 };
  const skuIds = new Map<string, bigint>();
  for (const l of lines) {
    if (skuIds.has(l.itemId)) continue;
    // Orders only fill in products the catalog has not provided yet.
    skuIds.set(l.itemId, await upsertSku(ctx, l.itemId, { name: l.productName, mrp: l.mrp, category: l.businessCategory }, false));
  }
  for (let i = 0; i < lines.length; i += 200) {
    await prisma.$transaction(lines.slice(i, i + 200).map((l) => {
      const data = {
        skuId: skuIds.get(l.itemId), orderDate: new Date(l.orderDate), productName: l.productName, variant: l.variant,
        categoryPath: l.categoryPath, businessCategory: l.businessCategory, expansionLevel: l.expansionLevel,
        supplyCity: l.supplyCity, supplyState: l.supplyState, customerCity: l.customerCity, customerState: l.customerState,
        status: l.status, hsn: l.hsn, quantity: l.quantity, mrp: dec(l.mrp), sellingPrice: dec(l.sellingPrice),
        igstPct: dec(l.igstPct), cgstPct: dec(l.cgstPct), sgstPct: dec(l.sgstPct), cessPct: dec(l.cessPct),
        igstValue: dec(l.igstValue), cgstValue: dec(l.cgstValue), sgstValue: dec(l.sgstValue), cessValue: dec(l.cessValue),
        totalTax: dec(l.totalTax), grossAmount: new Prisma.Decimal(l.grossAmount), reportId,
      };
      return prisma.channelOrder.upsert({
        where: { brandId_platformId_orderId_itemId: { brandId: ctx.brandId, platformId: ctx.platformId, orderId: l.orderId, itemId: l.itemId } },
        create: { orgId: ctx.orgId, brandId: ctx.brandId, platformId: ctx.platformId, orderId: l.orderId, itemId: l.itemId, ...data },
        update: data,
      });
    }));
  }
  const dates = lines.map((l) => l.orderDate).sort();
  const from = dates[0], to = dates[dates.length - 1];
  await rebuildDailyMetrics(ctx, from, to);
  await rebuildPricing(ctx, from, to);
  return { imported: lines.length, from, to };
}

/** Recomputes DailyMetric (listing × day) for [from, to] from the stored order lines. */
export async function rebuildDailyMetrics(ctx: ChannelCtx, from: string, to: string): Promise<void> {
  const fromD = new Date(from), toD = new Date(to);
  const groups = await prisma.$queryRaw<{ skuId: bigint; day: Date; units: bigint; gmv: Prisma.Decimal; mrpValue: Prisma.Decimal }[]>`
    SELECT "skuId", "orderDate" AS day, SUM(quantity)::bigint AS units, SUM("grossAmount") AS gmv,
           SUM(COALESCE(mrp, 0) * quantity) AS "mrpValue"
    FROM "ChannelOrder"
    WHERE "brandId" = ${ctx.brandId} AND "platformId" = ${ctx.platformId} AND "skuId" IS NOT NULL
      AND "orderDate" BETWEEN ${fromD} AND ${toD} AND status !~* ${NOT_SOLD_STATUS}
    GROUP BY "skuId", "orderDate"`;
  const listingIds = new Map<string, bigint>();
  for (const g of groups) {
    const key = g.skuId.toString();
    if (listingIds.has(key)) continue;
    const l = await prisma.platformListing.upsert({
      where: { skuId_platformId: { skuId: g.skuId, platformId: ctx.platformId } },
      create: { skuId: g.skuId, platformId: ctx.platformId }, update: {}, select: { id: true },
    });
    listingIds.set(key, l.id);
  }
  await prisma.$transaction([
    prisma.$executeRaw`
      DELETE FROM "DailyMetric" dm USING "PlatformListing" pl, "Sku" s
      WHERE dm."listingId" = pl.id AND pl."skuId" = s.id AND s."brandId" = ${ctx.brandId}
        AND pl."platformId" = ${ctx.platformId} AND dm."metricDate" BETWEEN ${fromD} AND ${toD}`,
    prisma.dailyMetric.createMany({
      data: groups.map((g) => {
        const units = Number(g.units);
        return {
          listingId: listingIds.get(g.skuId.toString())!, metricDate: g.day, gmv: g.gmv, unitsSold: units,
          avgSellPrice: units ? new Prisma.Decimal(g.gmv).div(units).toDecimalPlaces(2) : null,
          discountPct: Number(g.mrpValue) > 0 && Number(g.gmv) <= Number(g.mrpValue)
            ? new Prisma.Decimal(1).minus(new Prisma.Decimal(g.gmv).div(g.mrpValue)).times(100).toDecimalPlaces(2) : null,
        };
      }),
    }),
  ]);
}


/**
 * Recomputes PricingSnapshot (listing × city × day) for [from, to] from order lines:
 * quantity-weighted selling price per supply city, with MRP and discount. Catalog
 * "National" snapshots are left alone.
 */
export async function rebuildPricing(ctx: ChannelCtx, from: string, to: string): Promise<void> {
  const fromD = new Date(from), toD = new Date(to);
  const rows = await prisma.$queryRaw<{ skuId: bigint; day: Date; city: string; sp: Prisma.Decimal; mrp: Prisma.Decimal | null }[]>`
    SELECT "skuId", "orderDate" AS day, COALESCE(NULLIF("supplyCity", ''), ${NATIONAL}) AS city,
           (SUM("sellingPrice" * quantity) / NULLIF(SUM(quantity), 0))::numeric(10,2) AS sp, MAX(mrp) AS mrp
    FROM "ChannelOrder"
    WHERE "brandId" = ${ctx.brandId} AND "platformId" = ${ctx.platformId} AND "skuId" IS NOT NULL
      AND "sellingPrice" IS NOT NULL AND "orderDate" BETWEEN ${fromD} AND ${toD} AND status !~* ${NOT_SOLD_STATUS}
    GROUP BY 1, 2, 3`;
  const cityOf = makeCityResolver();
  const listingOf = new Map<string, bigint>();
  const data = [];
  for (const r of rows) {
    const key = r.skuId.toString();
    if (!listingOf.has(key)) {
      const l = await prisma.platformListing.upsert({
        where: { skuId_platformId: { skuId: r.skuId, platformId: ctx.platformId } },
        create: { skuId: r.skuId, platformId: ctx.platformId }, update: {}, select: { id: true },
      });
      listingOf.set(key, l.id);
    }
    const sp = Number(r.sp), mrp = r.mrp == null ? null : Number(r.mrp);
    data.push({ listingId: listingOf.get(key)!, cityId: await cityOf(r.city), snapshotDate: r.day, sellingPrice: sp, mrp, discountPct: discount(sp, mrp) });
  }
  await prisma.$transaction([
    prisma.$executeRaw`
      DELETE FROM "PricingSnapshot" ps USING "PlatformListing" pl, "Sku" s, "City" c
      WHERE ps."listingId" = pl.id AND pl."skuId" = s.id AND ps."cityId" = c.id AND c.name <> ${NATIONAL}
        AND s."brandId" = ${ctx.brandId} AND pl."platformId" = ${ctx.platformId}
        AND ps."snapshotDate" BETWEEN ${fromD} AND ${toD}`,
    prisma.pricingSnapshot.createMany({ data, skipDuplicates: true }),
  ]);
}

/**
 * Stock on hand → ChannelInventory (item × warehouse for the snapshot day, replaced on
 * every sync) and AvailabilitySnapshot per item × city: warehouses with sellable stock
 * out of the warehouses that carry the item. An item with none in a city is out of stock.
 */
export async function ingestInventory(ctx: ChannelCtx, lines: StockLine[], reportId: bigint, day?: string): Promise<{ imported: number; date: string }> {
  const date = day ?? new Date().toISOString().slice(0, 10);
  const snapshotDate = new Date(date);
  const skuIds = new Map<string, bigint>();
  for (const l of lines) {
    if (!skuIds.has(l.itemId)) skuIds.set(l.itemId, await upsertSku(ctx, l.itemId, { name: l.itemName, packSize: l.uom }, false));
  }
  await prisma.$transaction([
    prisma.channelInventory.deleteMany({ where: { brandId: ctx.brandId, platformId: ctx.platformId, snapshotDate } }),
    prisma.channelInventory.createMany({
      data: lines.map((l) => ({ ...ctx, ...l, skuId: skuIds.get(l.itemId), snapshotDate, reportId })),
      skipDuplicates: true,
    }),
  ]);

  const byItemCity = new Map<string, { skuId: bigint; city: string; total: number; inStock: number }>();
  for (const l of lines) {
    const key = `${l.itemId}|${l.city}`;
    const e = byItemCity.get(key) ?? { skuId: skuIds.get(l.itemId)!, city: l.city, total: 0, inStock: 0 };
    e.total++; if (l.totalSellable > 0) e.inStock++;
    byItemCity.set(key, e);
  }
  const cityOf = makeCityResolver();
  const listingOf = new Map<string, bigint>();
  const data = [];
  for (const e of byItemCity.values()) {
    const key = e.skuId.toString();
    if (!listingOf.has(key)) {
      const l = await prisma.platformListing.upsert({
        where: { skuId_platformId: { skuId: e.skuId, platformId: ctx.platformId } },
        create: { skuId: e.skuId, platformId: ctx.platformId }, update: {}, select: { id: true },
      });
      listingOf.set(key, l.id);
    }
    data.push({
      listingId: listingOf.get(key)!, cityId: await cityOf(e.city), snapshotDate, storesTotal: e.total, storesInStock: e.inStock,
      availabilityPct: Math.round((e.inStock / e.total) * 10000) / 100, isOos: e.inStock === 0,
    });
  }
  await prisma.$transaction([
    prisma.$executeRaw`
      DELETE FROM "AvailabilitySnapshot" a USING "PlatformListing" pl, "Sku" s
      WHERE a."listingId" = pl.id AND pl."skuId" = s.id AND s."brandId" = ${ctx.brandId}
        AND pl."platformId" = ${ctx.platformId} AND a."snapshotDate" = ${snapshotDate}`,
    prisma.availabilitySnapshot.createMany({ data, skipDuplicates: true }),
  ]);
  return { imported: lines.length, date };
}
