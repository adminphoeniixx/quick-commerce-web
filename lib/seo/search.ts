// blinkit.com search results for Blinkit Ads keywords (agent MCP blinkit_keyword_rank):
// ingest → SearchListingObservation (+ VisibilityObservation for the SOV / ranking table),
// read → per keyword × city SEO view: organic vs ad rank, rating gap, price gap, title words.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ingestVisibilityCore } from "@/lib/ingest/ingestVisibility";
import type { NormalizedVisibilityRow } from "@/lib/ingest/contracts";

type J = Record<string, unknown>;
export interface SearchCtx { orgId: bigint; brandId: bigint; platformId: number }

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim().toLowerCase().replace(/[₹,\s]/g, "");
  const m = s.match(/^([\d.]+)(k|l|lakh)?$/);
  if (!m) return null;
  return Number(m[1]) * (m[2] === "k" ? 1e3 : m[2] ? 1e5 : 1);
};
const str = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));

async function ownMatchers(brandId: bigint, platformId: number) {
  const own = await prisma.channelProduct.findMany({ where: { brandId, platformId }, select: { productId: true, brandName: true } });
  const ids = new Set(own.map((o) => o.productId).filter((x): x is string => !!x));
  const brands = new Set(own.map((o) => o.brandName?.trim().toLowerCase().replace(/\s+/g, "")).filter((x): x is string => !!x));
  return (pid: string, brand: string) => ids.has(pid) || brands.has(brand.toLowerCase().replace(/\s+/g, ""));
}

export async function ingestSearch(ctx: SearchCtx, p: J) {
  const city = str(p.city) || "National";
  const location = str(p.location) || null;
  const date = str(p.date).slice(0, 10);
  const snapshotDate = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(snapshotDate.getTime())) throw new Error("Invalid date");
  const observedAt = new Date();
  const isOwn = await ownMatchers(ctx.brandId, ctx.platformId);
  const results = ((p.results as J[]) ?? []).filter((r) => str(r.keyword));
  const vis: NormalizedVisibilityRow[] = [];
  let rows = 0;
  for (const r of results) {
    const keyword = str(r.keyword).toLowerCase();
    let organic = 0;
    const seen = new Set<string>();
    const data = ((r.products as J[]) ?? []).filter((x) => {
      const id = str(x.productId);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    }).map((x, i) => {
      const isAd = !!x.isAd;
      const brandName = str(x.brand) || null;
      return {
        ...ctx, snapshotDate, keyword, city, location, rank: i + 1, organicRank: isAd ? null : ++organic,
        productId: str(x.productId), name: str(x.name) || str(x.productId), brandName, pack: str(x.pack) || null,
        rating: num(x.rating), ratingCount: num(x.ratingCount) == null ? null : Math.round(num(x.ratingCount)!),
        price: num(x.price), mrp: num(x.mrp), isAd, adCampaignId: x.adCampaignId != null ? str(x.adCampaignId) : null,
        inventory: num(x.inventory) == null ? null : Math.round(num(x.inventory)!), soldOut: !!x.soldOut,
        isOwn: isOwn(str(x.productId), brandName ?? ""), observedAt,
      };
    });
    await prisma.$transaction([
      prisma.searchListingObservation.deleteMany({ where: { brandId: ctx.brandId, platformId: ctx.platformId, snapshotDate, keyword, city } }),
      prisma.searchListingObservation.createMany({ data }),
    ]);
    rows += data.length;
    for (const d of data)
      vis.push({ keyword, cityName: city, date, observedBrand: d.brandName || d.name, skuCode: d.productId, rank: d.rank, page: Math.floor((d.rank - 1) / 12) + 1, isSponsored: d.isAd });
  }
  if (vis.length) {
    const slug = (await prisma.platform.findUnique({ where: { id: ctx.platformId }, select: { slug: true } }))?.slug ?? "blinkit";
    await ingestVisibilityCore({ orgId: ctx.orgId, brandId: ctx.brandId, platformSlug: slug as "blinkit", source: "API" }, { rows: vis, errors: [] });
  }
  return { keywords: results.length, rows, city, date };
}

// ── read model ───────────────────────────────────────────────────────────────────────
const STOP = new Set(["and", "with", "the", "of", "for", "in", "a", "g", "kg", "gm", "ml", "l", "x", "pack", "combo", "premium", "new"]);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d/.test(w));
const n = (v: unknown) => (v == null ? 0 : Number(v));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

const CITY_ALIAS: Record<string, string> = { gurugram: "gurgaon", bengaluru: "bangalore", mumbai: "bombay", kolkata: "calcutta", chennai: "madras" };
const cityKey = (c: string) => { const k = c.toLowerCase().replace(/[^a-z]/g, ""); return CITY_ALIAS[k] ?? k; };
const sameCity = (a: string, b: string) => cityKey(a) === cityKey(b);

type Obs = Awaited<ReturnType<typeof prisma.searchListingObservation.findMany>>[number];

export async function searchSeo(orgId: bigint, brandId: bigint) {
  const platforms = await prisma.platform.findMany({ where: { slug: { in: ["blinkit", "blinkit-ads"] } }, select: { id: true, slug: true } });
  const seller = platforms.find((p) => p.slug === "blinkit")?.id, ads = platforms.find((p) => p.slug === "blinkit-ads")?.id;
  if (!seller) return { snapshotDate: null, rows: [] };
  const latest = await prisma.searchListingObservation.findFirst({ where: { orgId, brandId, platformId: seller }, orderBy: { snapshotDate: "desc" }, select: { snapshotDate: true } });
  if (!latest) return { snapshotDate: null, rows: [] };
  const obs = await prisma.searchListingObservation.findMany({
    where: { orgId, brandId, platformId: seller, snapshotDate: latest.snapshotDate }, orderBy: [{ keyword: "asc" }, { city: "asc" }, { rank: "asc" }],
  });
  const from = new Date(latest.snapshotDate.getTime() - 30 * 86400_000);
  const keywords = [...new Set(obs.map((o) => o.keyword))];
  const [adKw, campaigns, ownProducts] = await Promise.all([
    ads && keywords.length ? prisma.$queryRaw<{ keyword: string; spend: unknown; sales: unknown; position: unknown; pids: string[] }[]>`
      SELECT lower(k.label) AS keyword, SUM(k.spend) AS spend, SUM(k."directSales" + k."indirectSales") AS sales, AVG(k.position) AS position,
             ARRAY_AGG(DISTINCT pid) FILTER (WHERE pid IS NOT NULL) AS pids
      FROM "AdKeywordDaily" k
      LEFT JOIN "AdCampaign" c ON c."brandId" = k."brandId" AND c."platformId" = k."platformId" AND c."campaignId" = k."campaignId"
      LEFT JOIN LATERAL unnest(c."productIds") AS pid ON true
      WHERE k."brandId" = ${brandId} AND k."platformId" = ${ads} AND k.dimension = 'keyword' AND k.date BETWEEN ${from} AND ${latest.snapshotDate}
        AND lower(k.label) IN (${Prisma.join(keywords)})
      GROUP BY 1` : Promise.resolve([]),
    ads ? prisma.adCampaign.findMany({ where: { brandId, platformId: ads }, select: { campaignId: true, name: true } }) : Promise.resolve([]),
    prisma.channelProduct.findMany({ where: { brandId, platformId: seller }, select: { productId: true, name: true } }),
  ]);
  const listing = await prisma.listingSeoSnapshot.findMany({
    where: { orgId, brandId, platformId: seller }, orderBy: { snapshotDate: "desc" }, distinct: ["productId"],
    select: { productId: true, name: true, cities: true, availabilityPct: true },
  });
  const coverage = new Map(listing.map((l) => [l.productId, l]));
  const campaignName = new Map(campaigns.map((c) => [c.campaignId, c.name]));
  const ownName = new Map(ownProducts.map((p) => [p.productId ?? "", p.name]));
  const groups = new Map<string, Obs[]>();
  for (const o of obs) { const k = `${o.keyword}|${o.city}`; groups.set(k, [...(groups.get(k) ?? []), o]); }

  const rows = [...groups.values()].map((list) => {
    const { keyword, city } = list[0];
    const own = list.filter((o) => o.isOwn);
    const organicOwn = own.filter((o) => !o.isAd);
    const adOwn = own.filter((o) => o.isAd);
    const best = own[0] ?? null;
    const top10 = list.slice(0, 10), compTop = list.filter((o) => !o.isOwn && !o.isAd).slice(0, 10);
    const ak = adKw.find((a) => a.keyword === keyword);
    // Title words competitors ranking organically use, missing from the titles of the products advertised on this keyword.
    const ownTitles = [...own.map((o) => o.name), ...((ak?.pids ?? []).map((pid) => ownName.get(pid)).filter((x): x is string => !!x))];
    const ownWords = new Set(ownTitles.flatMap(words));
    const brandWords = new Set(list.flatMap((o) => words(o.brandName ?? "")));
    const freq = new Map<string, number>();
    for (const c of compTop) for (const w of new Set(words(c.name))) if (!ownWords.has(w) && !brandWords.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
    const missingWords = [...freq.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w, c]) => ({ word: w, competitors: c }));
    const compRatings = compTop.map((c) => c.rating).filter((x): x is number => x != null);
    const compCounts = compTop.map((c) => c.ratingCount).filter((x): x is number => x != null);
    const compPrices = compTop.map((c) => c.price).filter((x): x is number => x != null);
    const spend = n(ak?.spend), sales = n(ak?.sales);
    const tips: string[] = [];
    // The products advertised on this keyword: are they served in this city (Seller Hub expansion)?
    // Campaigns targeting "all products" carry no product ids: fall back to own products whose title shares a keyword word.
    const kwWords = words(keyword).filter((w) => w.length >= 4);
    const advertised = ak?.pids?.length ? [...new Set(ak.pids)]
      : ownProducts.filter((p) => p.productId && kwWords.some((w) => words(p.name).some((x) => x.startsWith(w) || w.startsWith(x)))).map((p) => p.productId!);
    const cover = advertised.map((pid) => {
      const l = coverage.get(pid);
      const c = ((l?.cities ?? []) as { city: string; live: number | null; closed: number | null; availabilityPct: number | null }[]).find((x) => sameCity(x.city, city));
      return { productId: pid, name: l?.name ?? ownName.get(pid) ?? pid, live: c?.live ?? null, closed: c?.closed ?? null, availabilityPct: c?.availabilityPct ?? null, known: !!l, listed: !!c };
    });
    const relevantTitles = [...ownTitles, ...advertised.map((pid) => ownName.get(pid)).filter((x): x is string => !!x)];
    const titleCovers = relevantTitles.some((t) => words(keyword).every((w) => words(t).some((x) => x.startsWith(w) || w.startsWith(x))));
    if (!organicOwn.length) {
      if (own.length) tips.push("Visible only through the ad: no organic rank in the results read.");
      else {
        const notServed = cover.filter((c) => c.known && (!c.listed || !c.live));
        if (notServed.length) tips.push(`Not in the top ${list.length} results. Seller Hub: ${notServed.map((c) => `${c.name} has ${c.listed ? `${c.live ?? 0} live / ${c.closed ?? 0} closed stores` : "no stores"} in ${city}`).join("; ")} — it can't rank where it isn't stocked.`);
        else {
          const served = cover.filter((c) => c.listed && c.live);
          const why = served.length
            ? ` Seller Hub: ${served.map((c) => (c.availabilityPct ?? 0) < 50
                ? `${c.name} is live in ${c.live} stores here but availability is only ${c.availabilityPct ?? "—"}%, so the store serving this address is probably out of stock`
                : `${c.name} is stocked here (${c.live} stores, ${c.availabilityPct}% availability), so this is a ranking problem: title relevance, ratings and sales velocity`).join("; ")}.`
            : "";
          tips.push(`Not in the top ${list.length} results in ${city}.${why}${titleCovers ? "" : ` Add "${keyword}" to the title/description of the product you advertise on it.`}`);
        }
      }
    } else if (!titleCovers && relevantTitles.length) tips.push(`"${keyword}" is not in your product title: adding it helps organic matching.`);
    else if (organicOwn[0].organicRank! > 10) tips.push(`Organic rank ${organicOwn[0].organicRank}: customers rarely scroll past ~10; improve title match, ratings and sales velocity.`);
    if (ak && spend > 0 && !adOwn.length) tips.push(`Ad keyword (₹${Math.round(spend)} spent in 30 days) but no ad seen in this city today: check campaign status, city targeting and daily budget.`);
    if (best?.rating != null && compRatings.length && best.rating < (avg(compRatings) ?? 0) - 0.2) tips.push(`Rating ${best.rating} vs competitors' ${avg(compRatings)!.toFixed(1)}: work on product/packaging complaints.`);
    if (best && best.rating == null) tips.push("No rating shown yet: Blinkit shows ratings after 20 customer ratings; push repeat buyers to rate.");
    else if (best?.ratingCount != null && compCounts.length && best.ratingCount < (median(compCounts) ?? 0) / 10) tips.push(`Only ${best.ratingCount} ratings vs a typical ${median(compCounts)} for competitors: social proof gap.`);
    if (best?.price != null && compPrices.length && best.price > (median(compPrices) ?? 0) * 1.3) tips.push(`Price ₹${best.price} is well above the competitors' median ₹${median(compPrices)}.`);
    return {
      keyword, city, location: list[0].location, results: list.length, adsInTop10: top10.filter((o) => o.isAd).length,
      own: own.map((o) => ({ rank: o.rank, organicRank: o.organicRank, name: o.name, productId: o.productId, rating: o.rating, ratingCount: o.ratingCount,
        price: o.price, mrp: o.mrp, isAd: o.isAd, campaign: o.adCampaignId ? campaignName.get(o.adCampaignId) ?? o.adCampaignId : null, soldOut: o.soldOut })),
      bestOrganicRank: organicOwn[0]?.organicRank ?? null, bestAdRank: adOwn[0]?.rank ?? null,
      ads: ak ? { spend, sales, roas: spend ? sales / spend : null, avgPosition: ak.position == null ? null : Math.round(n(ak.position) * 10) / 10 } : null,
      competitors: { avgRating: avg(compRatings), medianRatingCount: median(compCounts), medianPrice: median(compPrices) },
      top: list.slice(0, 8).map((o) => ({ rank: o.rank, brand: o.brandName, name: o.name, rating: o.rating, ratingCount: o.ratingCount, price: o.price, isAd: o.isAd, isOwn: o.isOwn })),
      missingWords, tips, coverage: cover,
    };
  }).sort((a, b) => (b.ads?.sales ?? 0) - (a.ads?.sales ?? 0) || a.keyword.localeCompare(b.keyword) || a.city.localeCompare(b.city));
  return { snapshotDate: latest.snapshotDate.toISOString().slice(0, 10), rows };
}
