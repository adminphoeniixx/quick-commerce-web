// Latest stock-on-hand snapshot: totals, per-product rollup and per-warehouse lines.
import { prisma } from "@/lib/db";
import { handler, ok } from "@/lib/http";
import { sellerScope } from "@/lib/channels/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  const scope = await sellerScope(req, "inventory:read");
  const latest = await prisma.channelInventory.findFirst({
    where: { brandId: scope.brandId, platformId: scope.platformId }, orderBy: { snapshotDate: "desc" }, select: { snapshotDate: true },
  });
  if (!latest) return ok({ snapshotDate: null, totals: null, products: [] });
  const lines = await prisma.channelInventory.findMany({
    where: { brandId: scope.brandId, platformId: scope.platformId, snapshotDate: latest.snapshotDate },
    orderBy: [{ itemName: "asc" }, { warehouseName: "asc" }],
  });
  const sum = (k: keyof (typeof lines)[number]) => lines.reduce((n, l) => n + (l[k] as number), 0);
  const byItem = new Map<string, { itemId: string; itemName: string; uom: string | null; upc: string | null; sellable: number; darkstore: number; warehouse: number; inBetween: number; unsellable: number; incoming: number; sold7d: number; sold30d: number; warehouses: number; warehousesInStock: number; cities: Set<string>; citiesOos: Set<string>; lines: typeof lines }>();
  for (const l of lines) {
    const e = byItem.get(l.itemId) ?? { itemId: l.itemId, itemName: l.itemName, uom: l.uom, upc: l.upc, sellable: 0, darkstore: 0, warehouse: 0, inBetween: 0, unsellable: 0, incoming: 0, sold7d: 0, sold30d: 0, warehouses: 0, warehousesInStock: 0, cities: new Set<string>(), citiesOos: new Set<string>(), lines: [] as typeof lines };
    e.sellable += l.totalSellable; e.darkstore += l.darkstoreUnits; e.warehouse += l.warehouseUnits; e.inBetween += l.inBetweenUnits;
    e.unsellable += l.totalUnsellable; e.incoming += l.incomingScheduled; e.sold7d += l.sold7d; e.sold30d += l.sold30d;
    e.warehouses++; if (l.totalSellable > 0) e.warehousesInStock++;
    e.cities.add(l.city); e.lines.push(l);
    byItem.set(l.itemId, e);
  }
  const products = [...byItem.values()].map((e) => {
    for (const c of e.cities) if (!e.lines.some((l) => l.city === c && l.totalSellable > 0)) e.citiesOos.add(c);
    const perDay = e.sold30d / 30;
    return {
      ...e, cities: e.cities.size, citiesOos: [...e.citiesOos],
      daysOfCover: perDay > 0 ? Math.round(e.sellable / perDay) : null,
      lines: e.lines.map((l) => ({ warehouseName: l.warehouseName, city: l.city, sellable: l.totalSellable, warehouse: l.warehouseUnits, inBetween: l.inBetweenUnits, darkstore: l.darkstoreUnits, unsellable: l.totalUnsellable, damaged: l.damaged, nearExpiry: l.nearExpiry, expired: l.expired, incoming: l.incomingScheduled, sold7d: l.sold7d, sold30d: l.sold30d })),
    };
  }).sort((a, b) => b.sold30d - a.sold30d || a.itemName.localeCompare(b.itemName));
  return ok({
    snapshotDate: latest.snapshotDate.toISOString().slice(0, 10),
    totals: {
      sellable: sum("totalSellable"), darkstore: sum("darkstoreUnits"), warehouse: sum("warehouseUnits"), inBetween: sum("inBetweenUnits"),
      unsellable: sum("totalUnsellable"), incoming: sum("incomingScheduled"), sold30d: sum("sold30d"),
      products: products.length, warehouses: new Set(lines.map((l) => l.warehouseId)).size,
      outOfStockProducts: products.filter((p) => p.sellable === 0).length,
    },
    products,
  });
});
