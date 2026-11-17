// Loads Blinkit Ads payloads (services/browser/blinkit_ads.py) into QCP:
// account → AdAccountSnapshot, campaigns → AdCampaign, daily → AdCampaignDaily,
// keywords → AdKeywordDaily. Every window is replaced, so re-syncs never double count
// and late portal corrections (data refreshes a day later) overwrite older numbers.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ChannelCtx } from "@/lib/channels/ingest";

export const AD_REPORT_TYPES = ["ads_account", "ads_campaigns", "ads_daily", "ads_keywords"] as const;
export type AdReportType = (typeof AD_REPORT_TYPES)[number];
export const isAdReport = (t: string): t is AdReportType => (AD_REPORT_TYPES as readonly string[]).includes(t);

type J = Record<string, unknown>;
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const int = (v: unknown) => Math.round(num(v));
const dec = (v: unknown) => new Prisma.Decimal(num(v).toFixed(2));
const day = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00.000Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
/** Portal timestamps look like "2026-10-16 18:30:00+00:00"; 9999-… means "no end date". */
const ts = (v: unknown): Date | null => {
  if (typeof v !== "string" || !v || v.startsWith("9999")) return null;
  const d = new Date(v.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
};
const istToday = () => isoDay(new Date(Date.now() + 5.5 * 3600_000));

export async function ingestAdAccount(ctx: ChannelCtx, p: J): Promise<number> {
  const adv = ((p.advertisers as J[]) ?? [])[0];
  if (!adv) throw new Error("The ad account returned no advertiser");
  const wallet = (adv.wallet_details ?? {}) as J, credit = (adv.ad_credit_details ?? {}) as J;
  const snapshotDate = day(istToday());
  const data = {
    advertiserId: String(adv.id), advertiserName: (adv.name as string) ?? null, status: (adv.status as string) ?? null,
    walletBalance: wallet.balance != null ? dec(wallet.balance) : null,
    tentativeSpend: wallet.tentative_spend != null ? dec(wallet.tentative_spend) : null,
    creditBalance: credit.balance != null ? dec(credit.balance) : null,
    festive: { summary: p.festiveSummary ?? null, keywords: p.festiveKeywords ?? null } as Prisma.InputJsonValue,
    collections: (p.collections ?? []) as Prisma.InputJsonValue,
    details: { features: adv.features ?? {}, compliance: adv.compliance_status ?? null, walletActive: wallet.active ?? null,
      creditActive: credit.active ?? null, plans: p.plans ?? [], cities: p.cities ?? {}, user: p.user ?? null } as Prisma.InputJsonValue,
  };
  await prisma.adAccountSnapshot.upsert({
    where: { brandId_platformId_snapshotDate: { brandId: ctx.brandId, platformId: ctx.platformId, snapshotDate } },
    create: { ...ctx, snapshotDate, ...data }, update: data,
  });
  return 1;
}

async function cityNames(ctx: ChannelCtx): Promise<Record<string, string>> {
  const snap = await prisma.adAccountSnapshot.findFirst({
    where: { brandId: ctx.brandId, platformId: ctx.platformId }, orderBy: { snapshotDate: "desc" }, select: { details: true },
  });
  return (((snap?.details ?? {}) as J).cities ?? {}) as Record<string, string>;
}

export async function ingestAdCampaigns(ctx: ChannelCtx, p: J): Promise<number> {
  const list = (p.campaigns as J[]) ?? [];
  const details = (p.details ?? {}) as Record<string, J | null>;
  const cities = await cityNames(ctx);
  for (const c of list) {
    const id = String(c.id);
    const d = details[id];
    const base = {
      name: String(c.campaign_name ?? d?.name ?? id), campaignType: String(c.campaign_type ?? d?.campaign_type ?? "UNKNOWN"),
      status: String(c.campaign_status ?? d?.status ?? "UNKNOWN"), startAt: ts(c.start_ts ?? d?.start_ts), endAt: ts(c.end_ts ?? d?.end_ts),
    };
    // Settings only change when the detail was fetched (a recent sync skips idle campaigns).
    const extra = d ? {
      objective: (d.objective_type as string) || null,
      budget: d.campaign_budget != null ? dec(d.campaign_budget) : null,
      pacing: (d.pacing_type as string) || null, regionType: (d.region_type as string) || null,
      cities: ((d.region_ids as unknown[]) ?? []).map((r) => cities[String(r)] ?? String(r)),
      productIds: (((d.products as J[]) ?? []).map((x) => String(x.id))).concat(((d.pids as unknown[]) ?? []).map(String))
        .filter((v, i, a) => a.indexOf(v) === i),
      keywords: (d.keywords ?? []) as Prisma.InputJsonValue,
      lifetimeSpend: d.billed_amount != null ? dec(d.billed_amount) : null,
      lifetimeImpressions: d.impressions_served != null ? BigInt(int(d.impressions_served)) : null,
      lifetimeSales: d.campaign_sales != null ? dec(d.campaign_sales) : null,
      lifetimeAtc: d.campaign_atc != null ? int(d.campaign_atc) : null,
      details: Object.fromEntries(Object.entries(d).filter(([k]) => !["keywords", "products", "pids", "region_ids"].includes(k))) as Prisma.InputJsonValue,
    } : {};
    await prisma.adCampaign.upsert({
      where: { brandId_platformId_campaignId: { brandId: ctx.brandId, platformId: ctx.platformId, campaignId: id } },
      create: { ...ctx, campaignId: id, ...base, details: {}, ...extra },
      update: { ...base, ...extra },
    });
  }
  return list.length;
}

export async function ingestAdDaily(ctx: ChannelCtx, p: J): Promise<{ rows: number; from: string; to: string }> {
  const from = String(p.from), to = String(p.to);
  const series = (p.campaigns ?? {}) as Record<string, Record<string, J>>;
  const rows: Prisma.AdCampaignDailyCreateManyInput[] = [];
  for (const [campaignId, perDay] of Object.entries(series)) {
    for (const [d, m] of Object.entries(perDay)) {
      if (d < from || d > to) continue;
      rows.push({
        ...ctx, campaignId, date: day(d), spend: dec(m.budget_consumed), impressions: int(m.impressions),
        ctr: m.ctr != null ? new Prisma.Decimal(num(m.ctr).toFixed(4)) : null,
        directAtc: int(m.direct_atc), indirectAtc: int(m.indirect_atc), totalAtc: int(m.total_atc),
        directSales: dec(m.direct_sales), indirectSales: dec(m.indirect_sales), totalSales: dec(m.total_sales),
        directQty: int(m.direct_quantities_sold), indirectQty: int(m.indirect_quantities_sold), totalQty: int(m.total_quantities_sold),
        newUsers: int(m.new_users_acquired),
      });
    }
  }
  // Campaigns absent from the series had no activity in the window: their rows go too.
  await prisma.$transaction([
    prisma.adCampaignDaily.deleteMany({ where: { brandId: ctx.brandId, platformId: ctx.platformId, date: { gte: day(from), lte: day(to) } } }),
    prisma.adCampaignDaily.createMany({ data: rows, skipDuplicates: true }),
  ]);
  return { rows: rows.length, from, to };
}

export const NO_KEYWORD = "Recommendation placement (no keyword)";

export async function ingestAdKeywords(ctx: ChannelCtx, p: J): Promise<{ rows: number; from: string; to: string }> {
  const from = String(p.from), to = String(p.to);
  const rows: Prisma.AdKeywordDailyCreateManyInput[] = [];
  for (const entry of (p.days as J[]) ?? []) {
    const reporting = (entry.reporting ?? {}) as Record<string, J[]>;
    const seen = new Set<string>();
    for (const [dimension, list] of Object.entries(reporting)) {
      for (const r of list ?? []) {
        // Search campaigns report keywords; recommendation / banner campaigns report placements
        // (asset_type), sometimes several rows per placement and day, without any id.
        const label = String(r[dimension] || r.keyword || r.asset_type || r.name || r.id || NO_KEYWORD);
        const matchType = dimension === "keyword" ? ((r.match_type as string) ?? null) : "PLACEMENT";
        const base = `${dimension}:${r.sub_campaign_id ?? r.id ?? label}:${matchType ?? ""}`;
        let dimKey = base;
        for (let i = 2; seen.has(dimKey); i++) dimKey = `${base}#${i}`;
        seen.add(dimKey);
        rows.push({
          ...ctx, campaignId: String(entry.campaignId), date: day(String(entry.date)), dimension,
          dimKey, label, matchType, impressions: int(r.impressions), spend: dec(r.budget_consumed),
          directAtc: int(r.direct_atc), indirectAtc: int(r.indirect_atc), directSales: dec(r.direct_sales), indirectSales: dec(r.indirect_sales),
          directQty: int(r.direct_quantities_sold), indirectQty: int(r.indirect_quantities_sold), newUsers: int(r.new_users_acquired),
          position: r.most_viewed_position != null ? int(r.most_viewed_position) : null,
        });
      }
    }
  }
  await prisma.$transaction([
    prisma.adKeywordDaily.deleteMany({ where: { brandId: ctx.brandId, platformId: ctx.platformId, date: { gte: day(from), lte: day(to) } } }),
    prisma.adKeywordDaily.createMany({ data: rows, skipDuplicates: true }),
  ]);
  return { rows: rows.length, from, to };
}

/** Ingests one ad payload; returns rows imported and the covered period (for ChannelReport). */
export async function ingestAdReport(ctx: ChannelCtx, type: AdReportType, payload: J): Promise<{ rows: number; from?: string; to?: string }> {
  switch (type) {
    case "ads_account": return { rows: await ingestAdAccount(ctx, payload) };
    case "ads_campaigns": return { rows: await ingestAdCampaigns(ctx, payload), from: String(payload.from), to: String(payload.to) };
    case "ads_daily": return ingestAdDaily(ctx, payload);
    case "ads_keywords": return ingestAdKeywords(ctx, payload);
  }
}
