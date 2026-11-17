// Client for the internal browser service (services/browser): remote login sessions
// and scheduled report downloads for platforms without an official API.
import { ApiError } from "@/lib/http";

export const BROWSER_PLATFORMS = ["blinkit", "blinkit-ads"] as const;

export function browserSupported(platformSlug: string): boolean {
  return (BROWSER_PLATFORMS as readonly string[]).includes(platformSlug) && Boolean(process.env.BROWSER_SERVICE_URL);
}

function base(): string {
  const url = process.env.BROWSER_SERVICE_URL;
  if (!url) throw new ApiError(503, "browser_unavailable", "Browser service is not configured");
  return url.replace(/\/+$/, "");
}

async function call(path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("x-service-token", process.env.BROWSER_SERVICE_TOKEN ?? "");
  try {
    return await fetch(base() + path, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(503, "browser_unavailable", "Browser service is not reachable");
  }
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status === 404 ? 409 : res.status >= 500 ? 502 : res.status, "browser_error", body.detail || body.message || `Browser service error ${res.status}`);
  return body as T;
}

const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
});

export const startSession = (id: bigint, platform: string) =>
  call(`/sessions/${id}/start`, jsonInit("POST", { platform }), 90_000).then(json<{ started: boolean }>);

export const sessionState = (id: bigint) =>
  call(`/sessions/${id}/state`).then(json<{ url: string; loggedIn: boolean; blocked: boolean; captcha: boolean; loginForm: boolean }>);

export const sessionFrame = (id: bigint) => call(`/sessions/${id}/frame`);

export const sessionInput = (id: bigint, input: Record<string, unknown>) =>
  call(`/sessions/${id}/input`, jsonInit("POST", input)).then(json<{ ok: boolean }>);

/** Opens an emailed sign-in link (Blinkit Ads magic link) in the live login window. */
export const openSessionLink = (id: bigint, url: string) =>
  call(`/sessions/${id}/open-link`, jsonInit("POST", { url }), 90_000).then(json<{ opened: boolean; loggedIn: boolean }>);

export const stopSession = (id: bigint) => call(`/sessions/${id}/stop`, jsonInit("POST")).then(json<{ stopped: boolean }>);

export async function checkSession(id: bigint, platform: string): Promise<{ ok: boolean; code?: string }> {
  const res = await call(`/sessions/${id}/health-check`, jsonInit("POST", { platform }), 90_000);
  const body = await res.json().catch(() => ({}));
  return res.ok ? { ok: true } : { ok: false, code: body.code || "unknown" };
}

export const deleteProfile = (id: bigint) => call(`/profiles/${id}`, { method: "DELETE" }).then(json<{ deleted: boolean }>);

export interface FetchedReport {
  type: "sales_summary" | "product_listing" | "stock_on_hand" | "listing_seo" | "search_seo" | "ads_account" | "ads_campaigns" | "ads_daily" | "ads_keywords" | "ads_bids" | "ads_campaign_action";
  range: string | null;
  status: "ok" | "failed";
  fileName?: string;
  data?: string; // base64
  code?: string;
  error?: string;
}

export type SyncOutcome =
  | { ok: true; reports: FetchedReport[] }
  | { ok: false; code: "login_required" | "blocked" | "captcha" | "busy" | string; message: string };

export interface SyncOptions {
  mode?: "full" | "recent"; ranges?: string[]; sales?: boolean; catalog?: boolean; inventory?: boolean;
  /** Seller Hub listing SEO (Blinkit seller connection); on by default. */
  seo?: boolean;
  /** blinkit.com search SEO for these ad keywords at this delivery location (area + city). */
  search?: { keywords: string[]; location: string };
  /** Blinkit Ads only: apply these approved keyword bid changes and do nothing else. */
  bids?: { id: string; campaign_id: number; keyword: string; match_type: string; from_cpm: number | null; to_cpm: number }[];
  /** Blinkit Ads only: one verified campaign mutation and no report sync. */
  campaignAction?: {
    action: "stop" | "restart" | "update" | "duplicate"; campaign_id: number;
    expected_status?: string; expected_budget?: number | null; name?: string; budget?: number;
    start?: string; end?: string; no_end?: boolean;
  };
}

export interface SyncStep {
  type: FetchedReport["type"]; range: string | null; label: string;
  status: "pending" | "running" | "ok" | "failed"; error?: string; startedAt?: number; finishedAt?: number;
}
export interface SyncJobStatus {
  id: string; status: "running" | "done" | "error"; activity: string; startedAt: number; finishedAt?: number;
  elapsedSeconds: number; etaSeconds: number | null; steps: SyncStep[]; error?: { code: string; message: string };
}

export async function syncJobStatus(id: bigint): Promise<SyncJobStatus | null> {
  const res = await call(`/sync/${id}/status`);
  if (res.status === 404) return null;
  return json<SyncJobStatus>(res);
}

export const syncFrame = (id: bigint) => call(`/sync/${id}/frame`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Downloads the seller-panel reports with the saved session (sales per range + catalog).
 * The service runs this as a background job; we poll it so long syncs never hit HTTP timeouts.
 */
export async function fetchReports(id: bigint, platform: string, opts: SyncOptions = {}): Promise<SyncOutcome> {
  const start = await call(`/sync/${id}`, jsonInit("POST", {
    platform, mode: opts.mode ?? "recent", ranges: opts.ranges, sales: opts.sales ?? true, catalog: opts.catalog ?? true,
    inventory: opts.inventory ?? opts.catalog ?? true, seo: opts.seo ?? true, search: opts.search, bids: opts.bids,
    campaign_action: opts.campaignAction,
  }));
  const started = await start.json().catch(() => ({}));
  if (start.status === 409) return { ok: false, code: "busy", message: started.detail || "Connection is busy" };
  if (start.status === 422) return { ok: false, code: started.code, message: started.message };
  if (!start.ok) throw new Error(started.detail || `Browser service error ${start.status}`);

  const deadline = Date.now() + 45 * 60_000;
  while (Date.now() < deadline) {
    await sleep(3000);
    const st = await syncJobStatus(id).catch(() => null);
    if (!st || st.id !== started.jobId) throw new Error("Sync job disappeared (browser service restarted?)");
    if (st.status === "running") continue;
    const res = await call(`/sync/${id}/result`, {}, 120_000);
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, reports: body.reports ?? [] };
    if (res.status === 422) return { ok: false, code: body.code, message: body.message };
    throw new Error(body.detail || `Browser service error ${res.status}`);
  }
  throw new Error("Sync took longer than 45 minutes");
}

export interface CampaignActionResult {
  action: "stop" | "restart" | "update" | "duplicate";
  campaignId: string; sourceCampaignId?: string;
  before: { status: string | null; budget: number | null; name: string | null };
  after: { status: string | null; budget: number | null; name: string | null };
  note?: string;
}

export async function applyCampaignAction(id: bigint, action: SyncOptions["campaignAction"]): Promise<CampaignActionResult> {
  if (!action) throw new ApiError(400, "bad_request", "Campaign action is required");
  const out = await fetchReports(id, "blinkit-ads", { sales: false, catalog: false, inventory: false, seo: false, campaignAction: action });
  if (!out.ok) throw new ApiError(out.code === "busy" ? 409 : 422, out.code, out.message);
  const report = out.reports.find((r) => r.type === "ads_campaign_action");
  if (!report?.data) {
    const status = report?.code === "conflict" ? 409 : report?.code === "rate_limited" ? 429 : 502;
    throw new ApiError(status, report?.code || "browser_error", report?.error || "Blinkit did not return the campaign result");
  }
  try {
    return JSON.parse(Buffer.from(report.data, "base64").toString("utf8")) as CampaignActionResult;
  } catch {
    throw new ApiError(502, "browser_error", "Blinkit returned an invalid campaign result");
  }
}
