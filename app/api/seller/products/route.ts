// Seller catalog with full platform details, plus sales totals per product.
import { prisma } from "@/lib/db";
import { handler, ok } from "@/lib/http";
import { sellerScope } from "@/lib/channels/queries";
import { NOT_SOLD_STATUS } from "@/lib/channels/ingest";
import { Prisma } from "@prisma/client";
import { dateRange } from "@/lib/channels/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  const scope = await sellerScope(req, "product:read");
  const q = scope.url.searchParams.get("q")?.trim();
  const range = dateRange(scope.url);
  const salesRange = range ? Prisma.sql`AND "orderDate" BETWEEN ${range.from} AND ${range.to}` : Prisma.empty;
  const [products, sales] = await Promise.all([
    prisma.channelProduct.findMany({
      where: {
        brandId: scope.brandId, platformId: scope.platformId,
        ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { itemId: q }, { productId: q }, { upc: q }] } : {}),
      },
      orderBy: { name: "asc" },
    }),
    prisma.$queryRaw<{ itemId: string; units: unknown; gmv: unknown; last: Date }[]>`
      SELECT "itemId", SUM(quantity) AS units, SUM("grossAmount") AS gmv, MAX("orderDate") AS last
      FROM "ChannelOrder" WHERE "brandId" = ${scope.brandId} AND "platformId" = ${scope.platformId} AND status !~* ${NOT_SOLD_STATUS} ${salesRange}
      GROUP BY 1`,
  ]);
  const byItem = new Map(sales.map((s) => [s.itemId, { units: Number(s.units), gmv: Number(s.gmv), lastOrder: s.last.toISOString().slice(0, 10) }]));
  return ok({ products: products.map((p) => ({ ...p, sales: byItem.get(p.itemId) ?? null })) });
});
