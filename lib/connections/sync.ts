// Browser-connector sync: download the seller-panel reports with the saved session,
// keep every file as a ChannelReport, and load catalog + order lines into QCP.
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { aggregateBrand } from "@/lib/analytics/aggregate";
import { parseProductListing, parseSalesSummary, parseStockOnHand } from "@/lib/channels/blinkit";
import { ingestCatalog, ingestInventory, ingestOrders, type ChannelCtx } from "@/lib/channels/ingest";
import { ingestAdReport, isAdReport, AD_REPORT_TYPES } from "@/lib/ads/ingest";
import { ingestListingSeo } from "@/lib/seo/ingest";
import { ingestSearch } from "@/lib/seo/search";
import { fetchReports, type FetchedReport, type SyncOptions } from "./browser";
import { BLOCK_CODES, MIN_SCHEDULED_GAP_MS, SEARCH_BLOCK_CODES, pauseConnection, pauseMessage, pauseSearch, searchPauseMessage } from "./guard";
import { createHash } from "node:crypto";

const NEEDS_RECONNECT = new Set(["login_required"]); // blocks pause the connection instead (guard.ts)
const REPORT_LABEL: Record<string, string> = {
  product_listing: "Product list", stock_on_hand: "Stock on hand", listing_seo: "Listing SEO", search_seo: "blinkit.com search SEO",
  ads_account: "Ad account", ads_campaigns: "Ad campaigns", ads_daily: "Daily ad performance", ads_keywords: "Keyword performance",
};
export type SyncTrigger = "connect" | "manual" | "retry" | "scheduled";

async function storeReport(ctx: ChannelCtx, r: FetchedReport, trigger: SyncTrigger): Promise<{ ok: boolean; changed: boolean; orders: number; label: string }> {
  const label = REPORT_LABEL[r.type] ?? `Sales ${r.range}`;
  if (r.status !== "ok" || !r.data) {
    await prisma.channelReport.create({
      data: { ...ctx, reportType: r.type, rangeLabel: r.range, status: "FAILED", error: r.error?.slice(0, 500) ?? "Download failed", trigger },
    });
    return { ok: false, changed: false, orders: 0, label };
  }
  const file = Buffer.from(r.data, "base64");
  const contentHash = createHash("sha256").update(file).digest("hex");
  let unchanged = await prisma.channelReport.findFirst({ where: { ...ctx, reportType: r.type, rangeLabel: r.range, status: "SUCCESS", contentHash }, select: { id: true } });
  if (!unchanged) {
    // Reports imported before contentHash existed must participate in deduplication too.
    // Backfill only matching recent files, then skip this import when bytes are identical.
    const legacy = await prisma.channelReport.findMany({
      where: { ...ctx, reportType: r.type, rangeLabel: r.range, status: "SUCCESS", contentHash: null, fileData: { not: null } },
      select: { id: true, fileData: true }, orderBy: { id: "desc" }, take: 5,
    });
    for (const previous of legacy) {
      const previousHash = createHash("sha256").update(previous.fileData!).digest("hex");
      await prisma.channelReport.update({ where: { id: previous.id }, data: { contentHash: previousHash } });
      if (previousHash === contentHash) unchanged = { id: previous.id };
    }
  }
  if (unchanged) return { ok: true, changed: false, orders: 0, label };
  const report = await prisma.channelReport.create({
    data: { ...ctx, reportType: r.type, rangeLabel: r.range, status: "SUCCESS", fileName: r.fileName, fileData: file, contentHash, trigger },
  });
  try {
    if (isAdReport(r.type)) {
      const res = await ingestAdReport(ctx, r.type, JSON.parse(file.toString("utf8")));
      await prisma.channelReport.update({
        where: { id: report.id },
        data: { rowsTotal: res.rows, rowsImported: res.rows, periodFrom: res.from ? new Date(res.from) : null, periodTo: res.to ? new Date(res.to) : null },
      });
      return { ok: true, changed: true, orders: res.rows, label };
    }
    if (r.type === "listing_seo" || r.type === "search_seo") {
      const payload = JSON.parse(file.toString("utf8"));
      const res = r.type === "listing_seo" ? await ingestListingSeo(ctx, payload) : await ingestSearch(ctx, payload);
      const rows = "products" in res ? res.products : res.rows;
      await prisma.channelReport.update({ where: { id: report.id }, data: { rowsTotal: rows, rowsImported: rows } });
      return { ok: true, changed: true, orders: 0, label };
    }
    if (r.type === "stock_on_hand") {
      const parsed = await parseStockOnHand(file);
      const res = await ingestInventory(ctx, parsed.rows, report.id, parsed.generatedAt);
      await prisma.channelReport.update({
        where: { id: report.id },
        data: { rowsTotal: parsed.rows.length + parsed.errors.length, rowsImported: res.imported, periodFrom: new Date(res.date), periodTo: new Date(res.date) },
      });
      return { ok: true, changed: true, orders: 0, label };
    }
    if (r.type === "product_listing") {
      const parsed = await parseProductListing(file);
      const n = await ingestCatalog(ctx, parsed.rows);
      await prisma.channelReport.update({ where: { id: report.id }, data: { rowsTotal: parsed.rows.length + parsed.errors.length, rowsImported: n } });
      return { ok: true, changed: true, orders: 0, label };
    }
    const parsed = await parseSalesSummary(file);
    const res = await ingestOrders(ctx, parsed.rows, report.id);
    await prisma.channelReport.update({
      where: { id: report.id },
      data: {
        rowsTotal: parsed.rows.length + parsed.errors.length, rowsImported: res.imported,
        periodFrom: res.from ? new Date(res.from) : null, periodTo: res.to ? new Date(res.to) : null,
        error: parsed.errors.length ? `${parsed.errors.length} rows skipped: ${parsed.errors[0].message}` : null,
      },
    });
    return { ok: true, changed: true, orders: res.imported, label };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await prisma.channelReport.update({ where: { id: report.id }, data: { status: "FAILED", error: `Import failed: ${message}`.slice(0, 500) } });
    logger.error("channel_report.import_failed", { reportId: report.id.toString(), error: e });
    return { ok: false, changed: false, orders: 0, label };
  }
}

/** Stores and imports fetched reports (catalog first), then refreshes dashboard rollups. */
export async function importReports(ctx: ChannelCtx, reports: FetchedReport[], trigger: SyncTrigger) {
  // Seller: catalog → inventory → sales. Ads: account (city names) → campaigns → daily → keywords.
  // SEO after sales/catalog: search SEO reads the listing snapshot (city coverage) at query time.
  const SEO_RANK: Partial<Record<FetchedReport["type"], number>> = { product_listing: 0, stock_on_hand: 1, listing_seo: 3, search_seo: 4 };
  const rank = (t: FetchedReport["type"]) => isAdReport(t) ? 10 + AD_REPORT_TYPES.indexOf(t) : SEO_RANK[t] ?? 2;
  const ordered = [...reports].sort((a, b) => rank(a.type) - rank(b.type));
  const results = [];
  for (const r of ordered) results.push(await storeReport(ctx, r, trigger));
  // Ad data has no sales rollup; only seller reports change AnalyticsDaily.
  if (results.some((result, index) => result.changed && ["sales_summary", "product_listing", "stock_on_hand"].includes(ordered[index].type))) await aggregateBrand(ctx.orgId, ctx.brandId);
  return results;
}

/** Only the public blinkit.com search step: no sales/catalog/inventory/listing data from the seller login. */
export const isPublicOnly = (o: SyncOptions) =>
  !!o.search?.keywords.length && o.sales === false && o.catalog === false && o.inventory === false && o.seo === false;

export const connectSyncMode = (hasSuccessfulReport: boolean): "full" | "recent" => hasSuccessfulReport ? "recent" : "full";

export async function runBrowserSync(connectionId: bigint, trigger: SyncTrigger, opts: SyncOptions = {}): Promise<string> {
  const c = await prisma.platformConnection.findUnique({ where: { id: connectionId }, include: { platform: true } });
  if (!c) return "skipped: connection deleted";
  // A search-only SEO sync reads the public blinkit.com storefront: it needs no seller login.
  const publicOnly = isPublicOnly(opts);
  if (c.status !== "CONNECTED" && !publicOnly) return `skipped: connection is ${c.status.toLowerCase()}`;
  // Block protection: after a block page / captcha / 429 nothing touches Blinkit until the pause ends.
  const paused = pauseMessage(c);
  if (paused) return `skipped: ${paused}`;
  if (opts.search && searchPauseMessage(c)) {
    if (publicOnly) return `skipped: ${searchPauseMessage(c)}`;
    opts = { ...opts, search: undefined };
  }
  // However often a schedule's cron fires, a scheduled sync runs at most every MIN_SCHEDULED_GAP_MS.
  if (trigger === "scheduled") {
    const recent = await prisma.syncJob.findFirst({
      where: { orgId: c.orgId, platformId: c.platformId, jobType: { endsWith: "_sync" }, startedAt: { gte: new Date(Date.now() - MIN_SCHEDULED_GAP_MS) } },
      select: { id: true },
    });
    if (recent) return "skipped: synced recently (scheduled syncs run at most every 6 hours)";
  }

  const job = await prisma.syncJob.create({ data: { orgId: c.orgId, platformId: c.platformId, jobType: `${trigger}_sync`, status: "RUNNING", startedAt: new Date() } });
  const finish = (status: "SUCCESS" | "FAILED", error: string | null, rows = 0) =>
    prisma.syncJob.update({ where: { id: job.id }, data: { status, error, rowsIngested: rows, finishedAt: new Date() } });

  try {
    const hasSuccessfulReport = trigger === "connect" && await prisma.channelReport.findFirst({ where: { brandId: c.brandId, platformId: c.platformId, status: "SUCCESS" }, select: { id: true } });
    const mode = trigger === "connect" ? connectSyncMode(Boolean(hasSuccessfulReport)) : "recent";
    const out = await fetchReports(c.id, c.platform.slug, { mode, ...opts });
    if (!out.ok) {
      if (NEEDS_RECONNECT.has(out.code)) {
        const msg = out.code === "login_required" ? `${c.platform.name} login expired. Click "Reconnect" to log in again.` : out.message;
        await prisma.platformConnection.update({ where: { id: c.id }, data: { status: "ERROR", lastError: msg } });
        await writeAudit({ orgId: c.orgId, action: "connection.session_lost", target: c.id.toString(), meta: { code: out.code } });
      }
      if (BLOCK_CODES.has(out.code)) await pauseConnection(c, out.code, out.message);
      await finish("FAILED", `${out.code}: ${out.message}`);
      return `failed: ${out.code}`;
    }

    // Catalog first so products carry full details before order lines reference them.
    const results = await importReports({ orgId: c.orgId, brandId: c.brandId, platformId: c.platformId }, out.reports, trigger);

    const failed = results.filter((r) => !r.ok).map((r) => r.label);
    const orders = results.reduce((n, r) => n + r.orders, 0);
    const okCount = results.length - failed.length;
    // Blinkit pushed back on one step: stop everything on this site (or just the public search) for a day.
    const blockedStep = out.reports.find((r) => r.code && BLOCK_CODES.has(r.code));
    if (blockedStep) await pauseConnection(c, blockedStep.code!, blockedStep.error ?? "");
    const searchBlocked = out.reports.find((r) => r.code && SEARCH_BLOCK_CODES.has(r.code));
    if (searchBlocked) await pauseSearch(c, searchBlocked.code!);
    // Listing SEO found the seller login gone (the search part still ran): flag the connection.
    if (out.reports.some((r) => r.code === "seller_login_required"))
      await prisma.platformConnection.update({ where: { id: c.id }, data: { status: "ERROR", lastError: `${c.platform.name} login expired. Click "Reconnect" to log in again.` } });
    // A public search says nothing about the seller login, so it leaves the connection as is.
    else if (!publicOnly) await prisma.platformConnection.update({
      where: { id: c.id },
      data: okCount ? { lastVerifiedAt: new Date(), lastError: failed.length ? `Not available: ${failed.join(", ")}` : null } : { lastError: `No report could be downloaded: ${failed.join(", ")}` },
    });
    await finish(okCount ? "SUCCESS" : "FAILED", failed.length ? `Failed: ${failed.join(", ")}` : null, orders);
    logger.info("browser_sync.completed", { connectionId: c.id.toString(), reports: results.length, failed: failed.length, orders });
    // Fresh Ads data: let the growth agents learn from any new bid changes / launches in it.
    if (okCount && c.platform.slug === "blinkit-ads") await import("@/lib/ads/growth-history").then((m) => m.scheduleHistoryLearning(c.orgId, c.brandId)).catch((error) => logger.error("growth.history_schedule_failed", { error }));
    return `ok: ${okCount}/${results.length} reports, ${orders} rows`;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await finish("FAILED", message.slice(0, 500));
    logger.error("browser_sync.failed", { connectionId: c.id.toString(), error: e });
    throw e;
  }
}
