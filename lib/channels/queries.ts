// Read models for the seller-data pages (sales analysis, orders, products, reports).
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { BadRequest } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { requirePermission, resolveOrgId } from "@/lib/rbac/authorize";
import type { Permission } from "@/lib/rbac/permissions";
import { NOT_SOLD_STATUS } from "./ingest";

export interface Scope { orgId: bigint; brandId: bigint; platformId: number; url: URL }

/** Session + permission + brand-in-org + platform resolution shared by the seller APIs. */
export async function sellerScope(req: Request, permission: Permission): Promise<Scope> {
  const session = await requireSession(req);
  const url = new URL(req.url);
  const orgId = resolveOrgId(session);
  await requirePermission(session, orgId, permission);
  const brandRaw = url.searchParams.get("brandId");
  const brand = brandRaw && /^\d+$/.test(brandRaw)
    ? await prisma.brand.findFirst({ where: { id: BigInt(brandRaw), orgId }, select: { id: true } })
    : await prisma.brand.findFirst({ where: { orgId }, orderBy: { id: "asc" }, select: { id: true } });
  if (!brand) throw BadRequest("Brand not found");
  const platform = await prisma.platform.findUnique({ where: { slug: url.searchParams.get("platform") || "blinkit" }, select: { id: true } });
  if (!platform) throw BadRequest("Unknown platform");
  return { orgId, brandId: brand.id, platformId: platform.id, url };
}

export function dateRange(url: URL): { from: Date; to: Date } | null {
  const f = url.searchParams.get("from"), t = url.searchParams.get("to");
  if (!f || !t) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || !/^\d{4}-\d{2}-\d{2}$/.test(t)) throw BadRequest("Dates must be YYYY-MM-DD");
  const from = new Date(`${f}T00:00:00.000Z`), to = new Date(`${t}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from.toISOString().slice(0, 10) !== f || to.toISOString().slice(0, 10) !== t) throw BadRequest("Dates must be valid calendar dates");
  if (from > to) throw BadRequest("From date must be on or before to date");
  return { from, to };
}

const n = (v: unknown) => (v == null ? 0 : Number(v));

export async function salesSummary(s: Scope, range: { from: Date; to: Date }) {
  const base = Prisma.sql`"brandId" = ${s.brandId} AND "platformId" = ${s.platformId} AND "orderDate" BETWEEN ${range.from} AND ${range.to}`;
  const sold = Prisma.sql`${base} AND status !~* ${NOT_SOLD_STATUS}`;
  const breakdown = (col: Prisma.Sql, limit = 50) => prisma.$queryRaw<{ key: string | null; gmv: unknown; units: unknown; orders: unknown }[]>`
    SELECT ${col} AS key, SUM("grossAmount") AS gmv, SUM(quantity) AS units, COUNT(DISTINCT "orderId") AS orders
    FROM "ChannelOrder" WHERE ${sold} GROUP BY 1 ORDER BY gmv DESC LIMIT ${limit}`;

  const [[k], [nk], trend, products, customerCities, customerStates, supplyCities, categories, statuses] = await Promise.all([
    prisma.$queryRaw<{ gmv: unknown; units: unknown; orders: unknown; lines: unknown; tax: unknown; mrpValue: unknown }[]>`
      SELECT SUM("grossAmount") AS gmv, SUM(quantity) AS units, COUNT(DISTINCT "orderId") AS orders, COUNT(*) AS lines,
             SUM("totalTax") AS tax, SUM(COALESCE(mrp, 0) * quantity) AS "mrpValue"
      FROM "ChannelOrder" WHERE ${sold}`,
    prisma.$queryRaw<{ lines: unknown; value: unknown }[]>`
      SELECT COUNT(*) AS lines, SUM("grossAmount") AS value FROM "ChannelOrder" WHERE ${base} AND status ~* ${NOT_SOLD_STATUS}`,
    prisma.$queryRaw<{ day: Date; gmv: unknown; units: unknown; orders: unknown }[]>`
      SELECT "orderDate" AS day, SUM("grossAmount") AS gmv, SUM(quantity) AS units, COUNT(DISTINCT "orderId") AS orders
      FROM "ChannelOrder" WHERE ${sold} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ itemId: string; name: string; gmv: unknown; units: unknown; orders: unknown; mrp: unknown }[]>`
      SELECT "itemId", MAX("productName") AS name, SUM("grossAmount") AS gmv, SUM(quantity) AS units,
             COUNT(DISTINCT "orderId") AS orders, MAX(mrp) AS mrp
      FROM "ChannelOrder" WHERE ${sold} GROUP BY 1 ORDER BY gmv DESC LIMIT 200`,
    breakdown(Prisma.sql`"customerCity"`),
    breakdown(Prisma.sql`"customerState"`),
    breakdown(Prisma.sql`"supplyCity"`),
    breakdown(Prisma.sql`"businessCategory"`),
    prisma.$queryRaw<{ status: string; lines: unknown; value: unknown }[]>`
      SELECT status, COUNT(*) AS lines, SUM("grossAmount") AS value FROM "ChannelOrder" WHERE ${base} GROUP BY 1 ORDER BY 2 DESC`,
  ]);

  const gmv = n(k?.gmv), orders = n(k?.orders), units = n(k?.units), mrpValue = n(k?.mrpValue);
  const rows = (list: { key: string | null; gmv: unknown; units: unknown; orders: unknown }[]) =>
    list.map((r) => ({ key: r.key ?? "Unknown", gmv: n(r.gmv), units: n(r.units), orders: n(r.orders), share: gmv ? n(r.gmv) / gmv : 0 }));
  return {
    range: { from: range.from.toISOString().slice(0, 10), to: range.to.toISOString().slice(0, 10) },
    kpis: {
      gmv, units, orders, lines: n(k?.lines), tax: n(k?.tax),
      aov: orders ? gmv / orders : null, unitsPerOrder: orders ? units / orders : null,
      discountPct: mrpValue ? (1 - gmv / mrpValue) * 100 : null,
      notSoldLines: n(nk?.lines), notSoldValue: n(nk?.value),
    },
    trend: trend.map((t) => ({ date: t.day.toISOString().slice(0, 10), gmv: n(t.gmv), units: n(t.units), orders: n(t.orders) })),
    products: products.map((p) => ({ itemId: p.itemId, name: p.name, gmv: n(p.gmv), units: n(p.units), orders: n(p.orders), mrp: p.mrp == null ? null : n(p.mrp), avgPrice: n(p.units) ? n(p.gmv) / n(p.units) : null, share: gmv ? n(p.gmv) / gmv : 0 })),
    customerCities: rows(customerCities), customerStates: rows(customerStates), supplyCities: rows(supplyCities), categories: rows(categories),
    statuses: statuses.map((x) => ({ status: x.status, lines: n(x.lines), value: n(x.value) })),
  };
}

export async function dataSpan(s: Scope) {
  const [span] = await prisma.$queryRaw<{ min: Date | null; max: Date | null; lines: unknown }[]>`
    SELECT MIN("orderDate") AS min, MAX("orderDate") AS max, COUNT(*) AS lines
    FROM "ChannelOrder" WHERE "brandId" = ${s.brandId} AND "platformId" = ${s.platformId}`;
  const connection = await prisma.platformConnection.findUnique({
    where: { brandId_platformId: { brandId: s.brandId, platformId: s.platformId } },
    select: { id: true, status: true, lastVerifiedAt: true, lastError: true },
  });
  return {
    from: span?.min?.toISOString().slice(0, 10) ?? null, to: span?.max?.toISOString().slice(0, 10) ?? null,
    orderLines: n(span?.lines), connection,
  };
}
