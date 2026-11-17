// Shared resolution helpers used by all ingestion services (with per-run caches).
import { prisma } from "@/lib/db";

export async function skuMap(brandId: bigint): Promise<Map<string, bigint>> {
  const skus = await prisma.sku.findMany({ where: { brandId }, select: { id: true, skuCode: true } });
  return new Map(skus.map((s) => [s.skuCode, s.id]));
}

export function makeListingResolver(platformId: number) {
  const cache = new Map<string, bigint>();
  return async (skuId: bigint): Promise<bigint> => {
    const key = skuId.toString();
    const hit = cache.get(key);
    if (hit) return hit;
    const listing = await prisma.platformListing.upsert({
      where: { skuId_platformId: { skuId, platformId } },
      create: { skuId, platformId },
      update: {},
      select: { id: true },
    });
    cache.set(key, listing.id);
    return listing.id;
  };
}

export function makeCityResolver() {
  const cache = new Map<string, number>();
  return async (name: string): Promise<number> => {
    const hit = cache.get(name);
    if (hit) return hit;
    let city = await prisma.city.findFirst({ where: { name }, select: { id: true } });
    if (!city) city = await prisma.city.create({ data: { name }, select: { id: true } });
    cache.set(name, city.id);
    return city.id;
  };
}

export function makeKeywordResolver(brandId: bigint) {
  const cache = new Map<string, bigint>();
  return async (term: string): Promise<bigint> => {
    const hit = cache.get(term);
    if (hit) return hit;
    const kw = await prisma.keyword.upsert({
      where: { brandId_term: { brandId, term } },
      create: { brandId, term },
      update: {},
      select: { id: true },
    });
    cache.set(term, kw.id);
    return kw.id;
  };
}
