// Order-line listing with filters and pagination; ?format=csv exports the filtered set.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { handler, ok } from "@/lib/http";
import { sellerScope, dateRange } from "@/lib/channels/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CSV_COLUMNS = [
  "orderId", "orderDate", "status", "itemId", "productName", "variant", "businessCategory", "categoryPath", "expansionLevel",
  "quantity", "mrp", "sellingPrice", "grossAmount", "totalTax", "igstPct", "cgstPct", "sgstPct", "cessPct",
  "igstValue", "cgstValue", "sgstValue", "cessValue", "hsn", "customerCity", "customerState", "supplyCity", "supplyState",
] as const;

function csvCell(v: unknown): string {
  let s = v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`; // spreadsheet formula injection guard
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const GET = handler(async (req) => {
  const scope = await sellerScope(req, "sales:read");
  const p = scope.url.searchParams;
  const range = dateRange(scope.url);
  const q = p.get("q")?.trim();
  const where: Prisma.ChannelOrderWhereInput = {
    brandId: scope.brandId, platformId: scope.platformId,
    ...(range ? { orderDate: { gte: range.from, lte: range.to } } : {}),
    ...(p.get("status") ? { status: p.get("status")! } : {}),
    ...(p.get("city") ? { customerCity: p.get("city")! } : {}),
    ...(p.get("itemId") ? { itemId: p.get("itemId")! } : {}),
    ...(q ? { OR: [{ orderId: { contains: q } }, { productName: { contains: q, mode: "insensitive" } }, { itemId: q }] } : {}),
  };
  const orderBy: Prisma.ChannelOrderOrderByWithRelationInput[] = [{ orderDate: "desc" }, { orderId: "desc" }];

  if (p.get("format") === "csv") {
    const rows = await prisma.channelOrder.findMany({ where, orderBy, take: 100_000 });
    const body = [CSV_COLUMNS.join(","), ...rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(","))].join("\n");
    return new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="orders.csv"` } });
  }

  const page = Math.max(1, Number(p.get("page") ?? 1));
  const pageSize = Math.min(200, Math.max(10, Number(p.get("page_size") ?? 50)));
  const [results, total, statuses, cities] = await Promise.all([
    prisma.channelOrder.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.channelOrder.count({ where }),
    prisma.channelOrder.groupBy({ by: ["status"], where: { brandId: scope.brandId, platformId: scope.platformId } }),
    prisma.channelOrder.groupBy({ by: ["customerCity"], where: { brandId: scope.brandId, platformId: scope.platformId }, orderBy: { customerCity: "asc" } }),
  ]);
  return ok({
    results, meta: { total_items: total, page, page_size: pageSize, total_pages: Math.ceil(total / pageSize) },
    filters: { statuses: statuses.map((s) => s.status), cities: cities.map((c) => c.customerCity).filter(Boolean) },
  });
});
