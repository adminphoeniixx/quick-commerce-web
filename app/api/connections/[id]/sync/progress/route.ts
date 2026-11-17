// Live progress of a browser-connector sync: download steps from the browser service,
// then the import into QCP (SyncJob), then a summary of what landed.
import { prisma } from "@/lib/db";
import { handler, ok } from "@/lib/http";
import { ownedBrowserConnection } from "@/lib/connections/owned";
import { syncJobStatus } from "@/lib/connections/browser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAVE_SECONDS = 15;
const REPORT_LABELS: Record<string, string> = {
  product_listing: "Product list (catalog)", stock_on_hand: "Stock on hand (inventory)",
  listing_seo: "Listing SEO (content, stores, availability)", search_seo: "blinkit.com search SEO",
  ads_account: "Ad account, wallet & insights", ads_campaigns: "Ad campaigns", ads_daily: "Daily campaign performance", ads_keywords: "Keyword performance",
};

export const GET = handler(async (req, ctx: { params: { id: string } }) => {
  const { connection: c } = await ownedBrowserConnection(req, ctx.params.id, "integration:read");
  const isAds = c.platform.slug === "blinkit-ads";
  const [job, svc] = await Promise.all([
    prisma.syncJob.findFirst({ where: { orgId: c.orgId, platformId: c.platformId, jobType: { endsWith: "_sync" } }, orderBy: { createdAt: "desc" } }),
    syncJobStatus(c.id).catch(() => null),
  ]);
  // ?since=<ms> ignores jobs that started before the caller pressed the button.
  const sinceParam = Number(new URL(req.url).searchParams.get("since"));
  const stale = Boolean(sinceParam && job?.startedAt && job.startedAt.getTime() < sinceParam - 2000 && svc?.status !== "running");
  const since = job?.startedAt ?? new Date();
  const reports = job ? await prisma.channelReport.findMany({
    where: { brandId: c.brandId, platformId: c.platformId, createdAt: { gte: since } },
    orderBy: { createdAt: "asc" }, select: { reportType: true, rangeLabel: true, status: true, rowsImported: true, error: true },
  }) : [];

  // An SEO-only sync (Keyword Intelligence "Sync SEO now") has no sales / catalog steps.
  const SEO_TYPES = new Set(["listing_seo", "search_seo"]);
  const seoOnly = !isAds && ((svc?.steps.length ?? 0) > 0 ? svc!.steps.every((s) => SEO_TYPES.has(s.type)) : reports.length > 0 && reports.every((r) => SEO_TYPES.has(r.reportType)));
  let phase: "queued" | "downloading" | "saving" | "done" | "failed";
  let activity: string;
  let etaSeconds: number | null = null;
  if (!job || stale || (job.status !== "RUNNING" && svc?.status === "running")) {
    phase = svc?.status === "running" ? "downloading" : "queued";
    activity = svc?.activity ?? "Starting sync…";
    etaSeconds = svc?.etaSeconds ?? null;
  } else if (job.status === "RUNNING") {
    if (svc?.status === "running") { phase = "downloading"; activity = svc.activity; etaSeconds = svc.etaSeconds; }
    else if (svc) {
      phase = "saving";
      activity = `Saving ${reports.length} of ${svc.steps.filter((s) => s.status === "ok").length} reports into the QCP database…`;
      etaSeconds = SAVE_SECONDS;
    } else { phase = "queued"; activity = "Starting browser…"; }
  } else {
    phase = job.status === "SUCCESS" ? "done" : "failed";
    activity = job.status !== "SUCCESS" ? (job.error ?? "Sync failed") : seoOnly ? "Finished: SEO data updated"
      : `Finished: ${job.rowsIngested.toLocaleString("en-IN")} ${isAds ? "ad rows" : "order lines"} updated`;
  }

  const scope = { brandId: c.brandId, platformId: c.platformId };
  const rowsOf = (t: string) => reports.filter((r) => r.reportType === t && r.status === "SUCCESS").reduce((a, r) => a + r.rowsImported, 0);
  const totals = phase !== "done" ? null : seoOnly ? {
    kind: "seo" as const, products: rowsOf("listing_seo"), searchResults: rowsOf("search_seo"),
    searchFailed: reports.some((r) => r.reportType === "search_seo" && r.status !== "SUCCESS"),
  } : isAds ? {
    kind: "ads" as const,
    campaigns: await prisma.adCampaign.count({ where: scope }),
    campaignDays: await prisma.adCampaignDaily.count({ where: scope }),
    keywordRows: await prisma.adKeywordDaily.count({ where: scope }),
  } : {
    kind: "seller" as const,
    products: await prisma.channelProduct.count({ where: scope }),
    orderLines: await prisma.channelOrder.count({ where: scope }),
  };

  return ok({
    phase, activity, etaSeconds,
    elapsedSeconds: job?.startedAt ? Math.round(((job.finishedAt ?? new Date()).getTime() - job.startedAt.getTime()) / 1000) : svc?.elapsedSeconds ?? 0,
    steps: svc?.steps.map((s) => ({ label: s.label, status: s.status, error: s.error, seconds: s.startedAt ? Math.round((s.finishedAt ?? Date.now() / 1000) - s.startedAt) : null })) ?? [],
    reports: reports.map((r) => ({ label: REPORT_LABELS[r.reportType] ?? `Sales report · ${r.rangeLabel}`, status: r.status, rows: r.rowsImported, error: r.error })),
    totals, connectionStatus: c.status, liveView: svc?.status === "running",
  });
});
