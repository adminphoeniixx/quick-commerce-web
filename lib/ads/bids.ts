// Blinkit Ads keyword bids: list every bid (per campaign × keyword × match type) with its
// performance, propose new bids, approve / reject them, and apply approved ones through the
// Blinkit Ads browser session (services/browser/blinkit_ads_bids.py, the portal's own bulk edit).
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { BadRequest } from "@/lib/http";
import { fetchReports } from "@/lib/connections/browser";
import type { AdsScope, Range } from "@/lib/ads/queries";
import {
  BID_APPLY_BATCH_DELAY_MS, BID_APPLY_RUNS_PER_DAY, BID_CHANGES_PER_DAY, BID_CHANGES_PER_KEYWORD_PER_DAY, BLOCK_CODES,
  istDayStart, pauseConnection, pauseMessage,
} from "@/lib/connections/guard";

export const BID_MIN = 50;
export const BID_MAX = 2000;
export const MAX_CHANGES_PER_REQUEST = 100;
const APPLYING_STALE_MS = 30 * 60_000; // an apply job that never reported back

export type BidStatus = "PENDING" | "APPROVED" | "APPLYING" | "APPLIED" | "CONFLICT" | "FAILED" | "REJECTED" | "CANCELLED";
const OPEN: BidStatus[] = ["PENDING", "APPROVED", "APPLYING"];

const n = (v: unknown) => (v == null ? null : Number(v));
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
/** AdKeywordDaily stores "EXACT_MATCH"; campaign bids use "EXACT". */
const mtKey = (m: string | null | undefined) => String(m ?? "").toUpperCase().replace(/_MATCH$/, "");
const rowKey = (campaignId: string, keyword: string, matchType: string) => `${campaignId}|${norm(keyword)}|${mtKey(matchType)}`;

interface StoredBid { match_type?: string; cpm?: number | string | null; max_boost?: number | null }
interface StoredKeyword { keyword: string; bids?: StoredBid[] }

function changeView(c: {
  id: bigint; campaignId: string; campaignName: string; keyword: string; matchType: string; fromCpm: unknown; toCpm: unknown; status: string;
  note: string | null; createdBy: string; decidedBy: string | null; decidedAt: Date | null; appliedAt: Date | null; beforeCpm: unknown; afterCpm: unknown;
  error: string | null; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: c.id.toString(), campaignId: c.campaignId, campaignName: c.campaignName, keyword: c.keyword, matchType: c.matchType,
    fromCpm: n(c.fromCpm), toCpm: n(c.toCpm), status: c.status as BidStatus, note: c.note, createdBy: c.createdBy,
    decidedBy: c.decidedBy, decidedAt: c.decidedAt, appliedAt: c.appliedAt, beforeCpm: n(c.beforeCpm), afterCpm: n(c.afterCpm),
    error: c.error, createdAt: c.createdAt, updatedAt: c.updatedAt,
  };
}
export type BidChangeView = ReturnType<typeof changeView>;

/** An apply job that died (container restart) must not leave changes stuck in APPLYING. */
async function expireStale(s: AdsScope) {
  await prisma.adBidChange.updateMany({
    where: { brandId: s.brandId, platformId: s.platformId, status: "APPLYING", updatedAt: { lt: new Date(Date.now() - APPLYING_STALE_MS) } },
    data: { status: "FAILED", error: "Apply was interrupted before Blinkit confirmed it: check the bid in Blinkit Ads, then Retry" },
  });
}

/** Every keyword bid of the brand's campaigns with performance in `r` and any open change. */
export async function listBids(s: AdsScope, r: Range | null, f: { productId?: string; campaignId?: string; activeOnly?: boolean } = {}) {
  await expireStale(s);
  const campaigns = await prisma.adCampaign.findMany({
    where: {
      brandId: s.brandId, platformId: s.platformId,
      ...(f.campaignId ? { campaignId: f.campaignId } : {}),
      ...(f.productId ? { productIds: { has: f.productId } } : {}),
      ...(f.activeOnly ? { status: "ACTIVE" } : {}),
    },
    select: { campaignId: true, name: true, campaignType: true, status: true, budget: true, productIds: true, keywords: true, updatedAt: true },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });
  const ids = campaigns.map((c) => c.campaignId);
  const allProducts = [...new Set(campaigns.flatMap((c) => c.productIds))];
  const [perf, products, open, recent] = await Promise.all([
    r && ids.length ? prisma.$queryRaw<{ campaignId: string; keyword: string; matchType: string | null; impressions: unknown; spend: unknown; sales: unknown; atc: unknown; position: unknown }[]>`
      SELECT "campaignId", lower(label) AS keyword, "matchType", SUM(impressions) AS impressions, SUM(spend) AS spend,
             SUM("directSales" + "indirectSales") AS sales, SUM("directAtc" + "indirectAtc") AS atc,
             SUM(position * impressions)::float / NULLIF(SUM(CASE WHEN position IS NOT NULL THEN impressions END), 0) AS position
      FROM "AdKeywordDaily"
      WHERE "brandId" = ${s.brandId} AND "platformId" = ${s.platformId} AND dimension = 'keyword'
        AND "campaignId" IN (${Prisma.join(ids)}) AND date BETWEEN ${r.from} AND ${r.to}
      GROUP BY 1, 2, 3` : Promise.resolve([]),
    s.sellerPlatformId && allProducts.length ? prisma.channelProduct.findMany({
      where: { brandId: s.brandId, platformId: s.sellerPlatformId, productId: { in: allProducts } }, select: { productId: true, name: true },
    }) : Promise.resolve([]),
    prisma.adBidChange.findMany({ where: { brandId: s.brandId, platformId: s.platformId, status: { in: OPEN }, ...(ids.length ? { campaignId: { in: ids } } : {}) } }),
    prisma.adBidChange.findMany({
      where: { brandId: s.brandId, platformId: s.platformId, status: { in: ["APPLIED", "FAILED", "CONFLICT"] }, ...(ids.length ? { campaignId: { in: ids } } : {}) },
      orderBy: { updatedAt: "desc" }, take: 500,
    }),
  ]);
  const productName = new Map(products.map((p) => [p.productId!, p.name]));
  const perfBy = new Map<string, { impressions: number; spend: number; sales: number; atc: number; position: number | null }>();
  for (const p of perf) {
    const row = { impressions: n(p.impressions)!, spend: n(p.spend)!, sales: n(p.sales)!, atc: n(p.atc)!, position: n(p.position) };
    perfBy.set(rowKey(p.campaignId, p.keyword, p.matchType ?? ""), row);
    // keyword total across match types, for bids whose match type the report names differently
    const k = `${p.campaignId}|${norm(p.keyword)}|*`, t = perfBy.get(k);
    perfBy.set(k, t ? { impressions: t.impressions + row.impressions, spend: t.spend + row.spend, sales: t.sales + row.sales, atc: t.atc + row.atc, position: t.position ?? row.position } : { ...row });
  }
  const openBy = new Map(open.map((c) => [rowKey(c.campaignId, c.keyword, c.matchType), changeView(c)]));
  const lastBy = new Map<string, BidChangeView>();
  for (const c of recent) { const k = rowKey(c.campaignId, c.keyword, c.matchType); if (!lastBy.has(k)) lastBy.set(k, changeView(c)); }

  const out = campaigns.map((c) => ({
    campaignId: c.campaignId, name: c.name, type: c.campaignType, status: c.status, budget: n(c.budget), syncedAt: c.updatedAt,
    products: c.productIds.map((id) => ({ productId: id, name: productName.get(id) ?? null })),
    keywords: ((c.keywords ?? []) as unknown as StoredKeyword[]).filter((k) => k?.keyword).map((k) => ({
      keyword: k.keyword,
      bids: (k.bids ?? []).filter((b) => b.match_type).map((b) => {
        const key = rowKey(c.campaignId, k.keyword, b.match_type!);
        const p = perfBy.get(key) ?? perfBy.get(`${c.campaignId}|${norm(k.keyword)}|*`) ?? null;
        return {
          matchType: mtKey(b.match_type), cpm: n(b.cpm), maxBoost: b.max_boost ?? null,
          perf: p && { ...p, roas: p.spend ? p.sales / p.spend : null },
          open: openBy.get(key) ?? null, last: lastBy.get(key) ?? null,
        };
      }),
    })),
  }));
  const [conn, changesToday] = await Promise.all([
    prisma.platformConnection.findUnique({ where: { brandId_platformId: { brandId: s.brandId, platformId: s.platformId } }, select: { status: true, pausedUntil: true, pauseReason: true } }),
    prisma.adBidChange.count({ where: { brandId: s.brandId, platformId: s.platformId, createdAt: { gte: istDayStart() }, status: { notIn: ["CANCELLED", "REJECTED"] } } }),
  ]);
  return {
    range: r && { from: r.from.toISOString().slice(0, 10), to: r.to.toISOString().slice(0, 10) },
    limits: { min: BID_MIN, max: BID_MAX, perDay: BID_CHANGES_PER_DAY, perKeywordPerDay: BID_CHANGES_PER_KEYWORD_PER_DAY, usedToday: changesToday },
    connection: conn && { status: conn.status, paused: pauseMessage(conn) },
    products: allProducts.map((id) => ({ productId: id, name: productName.get(id) ?? null })).sort((a, b) => (a.name ?? "~").localeCompare(b.name ?? "~")),
    campaigns: out,
  };
}

export interface ProposedBid { campaignId: string; keyword: string; matchType: string; toCpm: number; note?: string; evidence?: unknown; dataAsOf?: string; model?: string | null; promptVersion?: string; growthPlanId?: bigint }

/** New PENDING changes. A newer proposal for the same bid replaces an older PENDING one. */
export async function proposeBids(s: AdsScope, email: string, userId: bigint, changes: ProposedBid[]) {
  if (!changes.length) throw BadRequest("No bid changes");
  if (changes.length > MAX_CHANGES_PER_REQUEST) throw BadRequest(`At most ${MAX_CHANGES_PER_REQUEST} bid changes at a time`);
  const ids = [...new Set(changes.map((c) => c.campaignId))];
  const campaigns = new Map((await prisma.adCampaign.findMany({
    where: { brandId: s.brandId, platformId: s.platformId, campaignId: { in: ids } }, select: { campaignId: true, name: true, status: true, keywords: true },
  })).map((c) => [c.campaignId, c]));
  const open = await prisma.adBidChange.findMany({ where: { brandId: s.brandId, platformId: s.platformId, campaignId: { in: ids }, status: { in: OPEN } } });
  const openBy = new Map(open.map((c) => [rowKey(c.campaignId, c.keyword, c.matchType), c]));

  // Account safety: few bid edits a day, and not the same keyword again and again.
  const today = istDayStart();
  const [dayCount, kwToday] = await Promise.all([
    prisma.adBidChange.count({ where: { brandId: s.brandId, platformId: s.platformId, createdAt: { gte: today }, status: { notIn: ["CANCELLED", "REJECTED"] } } }),
    prisma.adBidChange.groupBy({
      by: ["campaignId", "keyword", "matchType"], _count: true,
      where: { brandId: s.brandId, platformId: s.platformId, campaignId: { in: ids }, createdAt: { gte: today }, status: { in: ["APPLIED", "APPROVED", "APPLYING", "FAILED"] } },
    }),
  ]);
  if (dayCount + changes.length > BID_CHANGES_PER_DAY) throw BadRequest(`At most ${BID_CHANGES_PER_DAY} bid changes a day protect your Blinkit Ads account; ${Math.max(0, BID_CHANGES_PER_DAY - dayCount)} left today`);
  const kwCount = new Map(kwToday.map((g) => [rowKey(g.campaignId, g.keyword, g.matchType), g._count]));

  const rows: Prisma.AdBidChangeCreateManyInput[] = [], replace: bigint[] = [], seen = new Set<string>();
  for (const ch of changes) {
    const recommendation = ch.evidence as { agentConsensus?: { verdict?: string } } | undefined;
    if (recommendation && recommendation.agentConsensus?.verdict !== "approve") throw BadRequest(`AI recommendation for "${ch.keyword}" is not approved by all specialist agents`);
    const camp = campaigns.get(ch.campaignId);
    if (!camp) throw BadRequest(`Campaign ${ch.campaignId} not found: sync Blinkit Ads first`);
    if (camp.status !== "ACTIVE") throw BadRequest(`Campaign "${camp.name}" is ${camp.status.toLowerCase()}; bids can change only in active campaigns`);
    const mt = mtKey(ch.matchType);
    const kw = ((camp.keywords ?? []) as unknown as StoredKeyword[]).find((k) => norm(k.keyword ?? "") === norm(ch.keyword));
    const bid = kw?.bids?.find((b) => mtKey(b.match_type) === mt);
    if (!kw || !bid) throw BadRequest(`"${ch.keyword}" (${mt}) is not a bid in campaign "${camp.name}"`);
    const to = Math.round(Number(ch.toCpm));
    if (!Number.isFinite(to) || to < BID_MIN || to > BID_MAX) throw BadRequest(`New bid for "${ch.keyword}" must be ₹${BID_MIN}–₹${BID_MAX} CPM`);
    const from = n(bid.cpm);
    if (from != null && Math.abs(from - to) < 0.5) throw BadRequest(`"${ch.keyword}" (${mt}) is already ₹${from} CPM`);
    if (from != null && Math.abs(to - from) / from > 0.15) throw BadRequest(`"${ch.keyword}" bid change cannot exceed 15% per approval`);
    const key = rowKey(ch.campaignId, kw.keyword, mt);
    if (seen.has(key)) throw BadRequest(`"${ch.keyword}" (${mt}) is listed twice`);
    seen.add(key);
    if ((kwCount.get(key) ?? 0) >= BID_CHANGES_PER_KEYWORD_PER_DAY) throw BadRequest(`"${ch.keyword}" (${mt}) was already changed ${BID_CHANGES_PER_KEYWORD_PER_DAY}x today; change it again tomorrow`);
    const existing = openBy.get(key);
    if (existing && existing.status !== "PENDING") throw BadRequest(`"${ch.keyword}" (${mt}) already has an approved change being applied`);
    if (existing) replace.push(existing.id);
    rows.push({
      orgId: s.orgId, brandId: s.brandId, platformId: s.platformId, campaignId: ch.campaignId, campaignName: camp.name,
      keyword: kw.keyword, matchType: mt, fromCpm: from, toCpm: to, note: ch.note?.slice(0, 300) || null,
      evidence: ch.evidence as Prisma.InputJsonValue | undefined, dataAsOf: ch.dataAsOf ? new Date(`${ch.dataAsOf}T00:00:00Z`) : null, model: ch.model ?? null, promptVersion: ch.promptVersion ?? null, growthPlanId: ch.growthPlanId ?? null, createdBy: email,
    });
  }
  await prisma.$transaction([
    prisma.adBidChange.updateMany({ where: { id: { in: replace }, status: "PENDING" }, data: { status: "CANCELLED", error: "Replaced by a newer proposal" } }),
    prisma.adBidChange.createMany({ data: rows }),
  ]);
  await writeAudit({ userId, orgId: s.orgId, action: "ads.bids_proposed", target: s.brandId.toString(), meta: { count: rows.length, changes: rows.map((r) => `${r.campaignId}:${r.keyword}:${r.matchType} ${r.fromCpm}→${r.toCpm}`) } });
  return { created: rows.length, replaced: replace.length };
}

/** Approve (→ APPROVED, then applied) or reject (→ REJECTED) PENDING changes; retry FAILED ones. */
export async function decideBids(s: AdsScope, email: string, userId: bigint, ids: bigint[], action: "approve" | "reject" | "retry" | "cancel") {
  if (!ids.length) throw BadRequest("No changes selected");
  const from: BidStatus[] = action === "retry" ? ["FAILED"] : ["PENDING"];
  const to: BidStatus = action === "reject" ? "REJECTED" : action === "cancel" ? "CANCELLED" : "APPROVED";
  const uniqueIds = [...new Set(ids.map(String))].map(BigInt);
  if (uniqueIds.length !== ids.length) throw BadRequest("Duplicate bid change IDs are not allowed");
  const res = await prisma.$transaction(async (tx) => {
    const where = { id: { in: uniqueIds }, brandId: s.brandId, platformId: s.platformId, status: { in: from }, ...(action === "cancel" ? { createdBy: email } : {}) };
    const eligible = await tx.adBidChange.findMany({ where, select: { id: true } });
    if (eligible.length !== uniqueIds.length) throw BadRequest("One or more bid changes are missing, no longer pending, or not owned by you");
    const updated = await tx.adBidChange.updateMany({ where, data: { status: to, decidedBy: email, decidedAt: new Date(), ...(action === "retry" ? { error: null } : {}) } });
    if (updated.count !== uniqueIds.length) throw BadRequest("Bid changes were updated concurrently; nothing was approved. Refresh and try again");
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  await writeAudit({ userId, orgId: s.orgId, action: `ads.bids_${action}`, target: s.brandId.toString(), meta: { ids: ids.map(String), updated: res.count } });
  return { updated: res.count, apply: to === "APPROVED" && res.count > 0 };
}

export async function bidHistory(s: AdsScope, limit = 200) {
  await expireStale(s);
  const rows = await prisma.adBidChange.findMany({ where: { brandId: s.brandId, platformId: s.platformId }, orderBy: { createdAt: "desc" }, take: limit });
  return rows.map(changeView);
}

interface BidResult { id: string; status: "applied" | "conflict" | "failed"; before?: number | null; after?: number | null; error?: string; note?: string }

/**
 * Applies every APPROVED change of the brand through the Blinkit Ads connection (browser service).
 * Returns "busy" when the connection is syncing: the caller retries later.
 */
export async function applyApprovedBids(orgId: bigint, brandId: bigint): Promise<"done" | "busy" | "none"> {
  const platform = await prisma.platform.findUnique({ where: { slug: "blinkit-ads" }, select: { id: true } });
  if (!platform) return "none";
  const approved = await prisma.adBidChange.findMany({ where: { orgId, brandId, platformId: platform.id, status: "APPROVED" }, orderBy: { id: "asc" }, take: 200 });
  if (!approved.length) return "none";
  const ids = approved.map((c) => c.id);
  const fail = (error: string, only = ids) =>
    prisma.adBidChange.updateMany({ where: { id: { in: only } }, data: { status: "FAILED", error: error.slice(0, 500) } });

  const conn = await prisma.platformConnection.findUnique({ where: { brandId_platformId: { brandId, platformId: platform.id } } });
  const paused = pauseMessage(conn);
  if (paused) { await fail(`${paused} Retry after that.`); return "done"; }
  const runsToday = await prisma.syncJob.count({ where: { orgId, platformId: platform.id, jobType: "ads_bids", startedAt: { gte: istDayStart() }, NOT: { error: "busy: retrying" } } });
  if (runsToday >= BID_APPLY_RUNS_PER_DAY) {
    await fail(`Bids were already applied ${BID_APPLY_RUNS_PER_DAY}x today; to protect the account the rest waits: Retry tomorrow`);
    return "done";
  }
  if (!conn || conn.status !== "CONNECTED") {
    const state = !conn ? "not connected" : conn.status === "ERROR" ? "logged out (login expired)" : conn.status.toLowerCase();
    await fail(`Blinkit Ads is ${state}: reconnect it on the Connections page, then Retry`);
    return "done";
  }
  // Claim the rows; a parallel apply run will not pick them up again.
  const claimed = await prisma.adBidChange.updateMany({ where: { id: { in: ids }, status: "APPROVED" }, data: { status: "APPLYING", error: null } });
  if (!claimed.count) return "none";
  const job = await prisma.syncJob.create({ data: { orgId, platformId: platform.id, jobType: "ads_bids", status: "RUNNING", startedAt: new Date() } });
  try {
    const out = await fetchReports(conn.id, "blinkit-ads", {
      bids: approved.map((c) => ({ id: c.id.toString(), campaign_id: Number(c.campaignId), keyword: c.keyword, match_type: c.matchType, from_cpm: n(c.fromCpm), to_cpm: n(c.toCpm)! })),
    });
    if (!out.ok) {
      if (out.code === "busy") {
        await prisma.adBidChange.updateMany({ where: { id: { in: ids }, status: "APPLYING" }, data: { status: "APPROVED" } });
        await prisma.syncJob.update({ where: { id: job.id }, data: { status: "FAILED", error: "busy: retrying", finishedAt: new Date() } });
        return "busy";
      }
      if (out.code === "login_required")
        await prisma.platformConnection.update({ where: { id: conn.id }, data: { status: "ERROR", lastError: 'Blinkit Ads login expired. Click "Reconnect" to log in again.' } });
      if (BLOCK_CODES.has(out.code)) await pauseConnection(conn, out.code, out.message);
      const msg = out.code === "login_required" ? "Blinkit Ads login expired: reconnect it on the Connections page, then Retry"
        : BLOCK_CODES.has(out.code) ? `Blinkit pushed back (${out.code}); all Blinkit Ads automation is paused for 24h to protect the account. Retry after that.`
        : `${out.code}: ${out.message}`;
      await fail(msg);
      await prisma.syncJob.update({ where: { id: job.id }, data: { status: "FAILED", error: msg.slice(0, 500), finishedAt: new Date() } });
      return "done";
    }
    const rep = out.reports.find((x) => x.type === "ads_bids");
    if (!rep || rep.status !== "ok" || !rep.data) {
      const msg = rep?.error ?? "Blinkit Ads did not return a result";
      await fail(msg);
      await prisma.syncJob.update({ where: { id: job.id }, data: { status: "FAILED", error: msg.slice(0, 500), finishedAt: new Date() } });
      return "done";
    }
    const results = (JSON.parse(Buffer.from(rep.data, "base64").toString("utf8")).results ?? []) as BidResult[];
    const byId = new Map(results.map((x) => [x.id, x]));
    let applied = 0;
    for (const c of approved) {
      const r = byId.get(c.id.toString());
      const status: BidStatus = r?.status === "applied" ? "APPLIED" : r?.status === "conflict" ? "CONFLICT" : "FAILED";
      await prisma.adBidChange.update({
        where: { id: c.id },
        data: { status, beforeCpm: r?.before ?? null, afterCpm: r?.after ?? null, appliedAt: status === "APPLIED" ? new Date() : null, error: r ? (r.error ?? r.note ?? null) : "No result from Blinkit Ads" },
      });
      if (status === "APPLIED") { applied++; await setStoredBid(brandId, platform.id, c.campaignId, c.keyword, c.matchType, n(r!.after ?? c.toCpm)!); }
      // Conflict: Blinkit has a different bid than QCP's last sync; show the real one until the next sync.
      else if (status === "CONFLICT" && r?.before != null) await setStoredBid(brandId, platform.id, c.campaignId, c.keyword, c.matchType, Number(r.before));
    }
    await prisma.syncJob.update({
      where: { id: job.id },
      data: { status: applied ? "SUCCESS" : "FAILED", rowsIngested: applied, finishedAt: new Date(), error: applied === approved.length ? null : `${approved.length - applied} of ${approved.length} not applied` },
    });
    await prisma.platformConnection.update({ where: { id: conn.id }, data: { lastVerifiedAt: new Date() } });
    await writeAudit({ orgId, action: "ads.bids_applied", target: brandId.toString(), meta: { applied, total: approved.length, results } });
    return "done";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error("ads_bids.apply_failed", { brandId: brandId.toString(), error: e });
    await prisma.adBidChange.updateMany({ where: { id: { in: ids }, status: "APPLYING" }, data: { status: "FAILED", error: `Apply failed: ${message}`.slice(0, 500) } });
    await prisma.syncJob.update({ where: { id: job.id }, data: { status: "FAILED", error: message.slice(0, 500), finishedAt: new Date() } });
    return "done";
  }
}

/** Keeps QCP's copy of the campaign's bids in step with Blinkit after an applied change. */
async function setStoredBid(brandId: bigint, platformId: number, campaignId: string, keyword: string, matchType: string, cpm: number) {
  const c = await prisma.adCampaign.findUnique({ where: { brandId_platformId_campaignId: { brandId, platformId, campaignId } }, select: { id: true, keywords: true } });
  if (!c) return;
  const kws = ((c.keywords ?? []) as unknown as StoredKeyword[]).map((k) => norm(k.keyword ?? "") !== norm(keyword) ? k : {
    ...k, bids: (k.bids ?? []).map((b) => (mtKey(b.match_type) === mtKey(matchType) ? { ...b, cpm } : b)),
  });
  await prisma.adCampaign.update({ where: { id: c.id }, data: { keywords: kws as unknown as Prisma.InputJsonValue } });
}

const BUSY_RETRY_MS = 60_000, BUSY_MAX_TRIES = 30; // the connection may be mid-sync: wait up to ~30 min

/** Runs applyApprovedBids now (worker queue when enabled), retrying while the connection is busy. */
export async function scheduleBidApply(orgId: bigint, brandId: bigint, delayMs = BID_APPLY_BATCH_DELAY_MS, attempt = 0): Promise<void> {
  const { queuesEnabled } = await import("@/lib/queue/connection");
  if (queuesEnabled()) {
    const { scheduledQueue } = await import("@/lib/queue/queues");
    // One queued apply per brand at a time: approvals made meanwhile ride along in the same Blinkit call.
    await scheduledQueue().add("ads-bids", { bidsOrgId: orgId.toString(), bidsBrandId: brandId.toString(), attempt }, {
      attempts: 1, delay: delayMs, jobId: `ads-bids-${brandId}-${Math.floor((Date.now() + delayMs) / BID_APPLY_BATCH_DELAY_MS)}`,
    });
    return;
  }
  setTimeout(() => {
    applyApprovedBids(orgId, brandId).then((r) => {
      if (r === "busy" && attempt < BUSY_MAX_TRIES) void scheduleBidApply(orgId, brandId, BUSY_RETRY_MS, attempt + 1);
    }).catch((error) => logger.error("ads_bids.schedule_failed", { error }));
  }, delayMs);
}

/** Worker entry: apply, and re-queue while the connection is busy. */
export async function processBidApply(orgId: bigint, brandId: bigint, attempt: number) {
  const r = await applyApprovedBids(orgId, brandId);
  if (r === "busy") {
    if (attempt < BUSY_MAX_TRIES) await scheduleBidApply(orgId, brandId, BUSY_RETRY_MS, attempt + 1);
    else await prisma.adBidChange.updateMany({ where: { orgId, brandId, status: "APPROVED" }, data: { status: "FAILED", error: "Blinkit Ads connection stayed busy for 30 minutes: Retry" } });
  }
  return r;
}
