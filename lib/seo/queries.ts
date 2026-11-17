// Read model for the "Product SEO" section of Keyword Intelligence: the latest Seller Hub
// listing snapshot per product, joined with the ad keywords that sell it (Blinkit Ads),
// city-wise orders (Seller Hub sales report) and the festive keyword trends for its category.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { NOT_SOLD_STATUS } from "@/lib/channels/ingest";
import type { Issue } from "./ingest";

const n = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

/** A keyword word is covered by the listing if a listing word equals it, extends it
 * ("edama" → "edamame") or is it without a short plural/inflection ending ("almonds" ↔ "almond"). */
function covered(w: string, text: Set<string>) {
  for (const t of text) {
    if (t === w || (w.length >= 3 && t.startsWith(w)) || (t.length >= 3 && w.startsWith(t) && w.length - t.length <= 2)) return true;
  }
  return false;
}

interface KwRow { productId: string; keyword: string; spend: unknown; sales: unknown; impressions: unknown; atc: unknown; position: unknown }
interface CityRow { itemId: string; city: string; units: unknown; sales: unknown }

export async function listingSeo(orgId: bigint, brandId: bigint, days = 30) {
  const platforms = await prisma.platform.findMany({ where: { slug: { in: ["blinkit", "blinkit-ads"] } }, select: { id: true, slug: true } });
  const seller = platforms.find((p) => p.slug === "blinkit")?.id;
  const ads = platforms.find((p) => p.slug === "blinkit-ads")?.id;
  if (!seller) return { snapshotDate: null, products: [], festive: [] };

  const latest = await prisma.listingSeoSnapshot.findFirst({
    where: { orgId, brandId, platformId: seller }, orderBy: { snapshotDate: "desc" }, select: { snapshotDate: true, updatedAt: true },
  });
  if (!latest) return { snapshotDate: null, products: [], festive: [] };
  const rows = await prisma.listingSeoSnapshot.findMany({
    where: { orgId, brandId, platformId: seller, snapshotDate: latest.snapshotDate }, orderBy: [{ sales: "desc" }, { name: "asc" }],
  });
  const to = latest.snapshotDate, from = new Date(to.getTime() - days * 86400_000);
  const pids = rows.map((r) => r.productId), items = rows.map((r) => r.itemId).filter((x): x is string => !!x);

  const [kw, cityRows, account] = await Promise.all([
    ads && pids.length ? prisma.$queryRaw<KwRow[]>`
      SELECT pid AS "productId", lower(k.label) AS keyword, SUM(k.spend) AS spend,
             SUM(k."directSales" + k."indirectSales") AS sales, SUM(k.impressions) AS impressions,
             SUM(k."directAtc" + k."indirectAtc") AS atc, AVG(k.position) AS position
      FROM "AdKeywordDaily" k
      JOIN "AdCampaign" c ON c."brandId" = k."brandId" AND c."platformId" = k."platformId" AND c."campaignId" = k."campaignId"
      CROSS JOIN LATERAL unnest(c."productIds") AS pid
      WHERE k."brandId" = ${brandId} AND k."platformId" = ${ads} AND k.dimension = 'keyword'
        AND k.date BETWEEN ${from} AND ${to} AND pid IN (${Prisma.join(pids)})
      GROUP BY pid, lower(k.label)` : Promise.resolve([] as KwRow[]),
    items.length ? prisma.$queryRaw<CityRow[]>`
      SELECT "itemId", COALESCE(NULLIF("customerCity", ''), "supplyCity", 'Unknown') AS city,
             SUM(quantity) AS units, SUM("grossAmount") AS sales
      FROM "ChannelOrder"
      WHERE "brandId" = ${brandId} AND "platformId" = ${seller} AND "orderDate" BETWEEN ${from} AND ${to}
        AND status !~* ${NOT_SOLD_STATUS} AND "itemId" IN (${Prisma.join(items)})
      GROUP BY 1, 2` : Promise.resolve([] as CityRow[]),
    ads ? prisma.adAccountSnapshot.findFirst({ where: { brandId, platformId: ads }, orderBy: { snapshotDate: "desc" }, select: { festive: true } }) : null,
  ]);

  const products = rows.map((r) => {
    const content = (r.content ?? {}) as { title?: string; description?: string; hindiName?: string | null };
    const text = new Set(words(`${content.title ?? r.name} ${content.description ?? ""} ${content.hindiName ?? ""}`));
    const keywords = kw.filter((k) => k.productId === r.productId)
      .map((k) => {
        const spend = n(k.spend), sales = n(k.sales);
        return { keyword: k.keyword, spend, sales, roas: spend ? sales / spend : null, impressions: n(k.impressions), atc: n(k.atc),
          avgPosition: k.position == null ? null : Math.round(n(k.position) * 10) / 10,
          inListing: words(k.keyword).every((w) => covered(w, text)) };
      })
      .sort((a, b) => b.sales - a.sales || b.spend - a.spend);
    const issues = [...((r.issues ?? []) as unknown as Issue[])];
    // Only profitable keywords are worth writing into the listing; loss-making ones are an ads problem.
    const gaps = keywords.filter((k) => k.sales > 0 && (k.roas ?? 0) >= 1 && !k.inListing).slice(0, 4);
    if (gaps.length)
      issues.push({ severity: "medium", code: "keyword_not_in_listing", message: `Selling ad keywords missing from title/description: ${gaps.map((g) => `"${g.keyword}"`).join(", ")}. Add them so organic search matches too.` });
    const cities = cityRows.filter((c) => c.itemId === r.itemId)
      .map((c) => ({ city: c.city, units: n(c.units), sales: n(c.sales) })).sort((a, b) => b.sales - a.sales);
    return {
      productId: r.productId, itemId: r.itemId, name: r.name, brand: r.brandName, category: r.category, unit: r.unit,
      expansionLevel: r.expansionLevel, availabilityPct: r.availabilityPct, availabilityTarget: r.availabilityTarget,
      unitsPerStoreDay: r.unitsPerStoreDay, unitsTarget: r.unitsTarget, salesPerStoreDay: r.salesPerStoreDay, salesTarget: r.salesTarget,
      complaintPct: r.complaintPct, stores: { live: r.storesLive, new: r.storesNew, closed: r.storesClosed },
      cityCount: { live: r.citiesLive, new: r.citiesNew, closed: r.citiesClosed },
      assessmentEnd: r.assessmentEnd ? iso(r.assessmentEnd) : null, period: r.periodLabel, units: r.units, sales: r.sales,
      salesSharePct: r.salesSharePct, complaints: r.complaints,
      listing: { titleLength: r.titleLength, descriptionLength: r.descriptionLength, imageCount: r.imageCount,
        attrsFilled: r.attrsFilled, attrsTotal: r.attrsTotal, engagementScore: r.engagementScore },
      content: r.content, missingAttributes: r.missingAttributes, expansionCities: r.cities, salesByCity: cities.slice(0, 15),
      keywords: keywords.slice(0, 15), issues,
    };
  });

  const festive = (((account?.festive as { keywords?: { festivals?: { name: string; start_date?: string; categories?: { category_name: string; keywords: { keyword: string; growth_multiple_label?: string; growth_multiple?: number }[] }[] }[] } } | null)?.keywords?.festivals) ?? [])
    .flatMap((f) => (f.categories ?? []).map((c) => ({ festival: f.name, start: f.start_date ?? null, category: c.category_name,
      keywords: (c.keywords ?? []).slice(0, 15).map((k) => ({ keyword: k.keyword, growth: k.growth_multiple_label ?? null })) })));

  return { snapshotDate: iso(latest.snapshotDate), updatedAt: latest.updatedAt, from: iso(from), to: iso(to), products, festive };
}
