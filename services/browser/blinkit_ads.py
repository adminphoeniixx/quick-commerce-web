"""Blinkit Ads (brands.blinkit.com, "Brand Central") collector.

Reads the brand's own ad account through the same JSON endpoints the portal's pages
call, inside the logged-in page (same session, same origin). Read-only: only the
listing / report queries the dashboard itself makes are used, throttled, and nothing
is ever created or changed. Shared by the QCP browser service and the local agent MCP.

Each collect_* function returns a JSON-serialisable payload that QCP ingests
(lib/ads/ingest.ts):
  ads_account   advertiser, wallet, ad credit, festive insights, collections, plans
  ads_campaigns campaign list with period metrics + per-campaign settings
  ads_daily     campaign × day metrics (spend, impressions, CTR, ATC, sales, qty, new users)
  ads_keywords  campaign × day × keyword (or other breakdown) performance
"""
import asyncio
import time
from datetime import date, datetime, timedelta, timezone
from typing import Awaitable, Callable

BASE = "https://brands.blinkit.com"
DASHBOARD = BASE + "/dashboard"
ALL_TYPES = ["PRODUCT_LISTING", "PRODUCT_RECOMMENDATION", "SHELF_DIY", "PRODUCT_INJECTION_DIY", "STORY_DIY",
             "BANNER_DIY", "BANNER_LISTING", "BRAND_SPOTLIGHT_DIY", "BRAND_BOOSTER"]
# The trends endpoint accepts at most 2 metrics per call. ROAS is derived (sales / spend).
DAILY_METRICS = ["budget_consumed", "impressions", "ctr", "total_atc", "direct_atc", "indirect_atc",
                 "total_sales", "direct_sales", "indirect_sales", "total_quantities_sold",
                 "direct_quantities_sold", "indirect_quantities_sold", "new_users_acquired"]
# Keep automation far below portal bursts. Campaign, bid, and report calls all share
# this delay, reducing HTTP 429 risk without retrying writes aggressively.
THROTTLE_S = 1.5

FETCH_JS = """async ([path, body, headers]) => {
  const r = await fetch(path, { method: body ? "POST" : "GET", credentials: "include",
    headers: { ...headers, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch (e) {}
  return { status: r.status, json };
}"""


class AdsError(Exception):
    """code: login_required | blocked | rate_limited | api_error"""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


IST = timezone(timedelta(hours=5, minutes=30))


def ist_today() -> date:
    """The portal reports IST days; servers usually run in UTC."""
    return datetime.now(IST).date()


def portal_date(d: date) -> str:
    return f"{d.month}/{d.day}/{d.year}"


def days(frm: date, to: date) -> list[date]:
    return [frm + timedelta(n) for n in range((to - frm).days + 1)]


class AdsApi:
    """Calls the portal's endpoints with the session the page itself uses."""

    def __init__(self, page):
        self.page = page
        self.headers: dict | None = None
        self.calls = 0

    async def authenticate(self) -> None:
        # The SPA attaches a short-lived Firebase ID token to every API call; reuse the one
        # it sends on load (it refreshes the token itself), never store it.
        page = self.page
        got = asyncio.get_running_loop().create_future()

        def on_request(req):
            h = req.headers
            if "/adservice/" in req.url and h.get("firebase_user_token") and not got.done():
                got.set_result({"firebase_user_token": h["firebase_user_token"], "x-session-id": h.get("x-session-id", "")})

        page.on("request", on_request)
        try:
            await page.goto(DASHBOARD, wait_until="domcontentloaded", timeout=60000)
            try:
                self.headers = await asyncio.wait_for(got, 25)
            except TimeoutError:
                text = (await page.evaluate("() => (document.body?.innerText || '').slice(0, 3000)")).lower()
                if "access denied" in text or "you have been blocked" in text:
                    raise AdsError("blocked", "Blinkit Ads blocked this browser")
                raise AdsError("login_required", "Blinkit Ads session expired; reconnect")
        finally:
            page.remove_listener("request", on_request)

    async def call(self, path: str, body: dict | None = None):
        if not self.headers:
            await self.authenticate()
        reauthed, last, rate_limited = False, "no response", False
        for attempt in range(5):
            await asyncio.sleep(THROTTLE_S)
            self.calls += 1
            try:
                r = await self.page.evaluate(FETCH_JS, [path, body, self.headers])
            except Exception as e:  # network blip inside the page ("Failed to fetch")
                last = str(e).splitlines()[0][:120]
                await asyncio.sleep(3 * (attempt + 1))
                continue
            status = r["status"]
            if status in (401, 403):
                if reauthed:
                    raise AdsError("login_required", "Blinkit Ads session expired; reconnect")
                reauthed = True
                await self.authenticate()  # token expired mid-sync: pick up the refreshed one
                continue
            if status == 429:
                # Blinkit says "too many requests": wait once, then stop the whole run (QCP pauses
                # this connection for a day). Hammering through a 429 is how accounts get blocked.
                if rate_limited:
                    raise AdsError("rate_limited", "Blinkit said too many requests (HTTP 429); stopped to protect the account")
                rate_limited = True
                await asyncio.sleep(60)
                continue
            if status >= 500:
                last = f"HTTP {status}"
                await asyncio.sleep(min(60, 5 * 2 ** attempt))  # 5, 10, 20, 40, 60s
                continue
            if status >= 400:
                msg = (r["json"] or {}).get("message") if isinstance(r["json"], dict) else None
                raise AdsError("api_error", f"Blinkit Ads {path} returned HTTP {status}: {str(msg)[:200]}")
            return r["json"] or {}
        raise AdsError("api_error", f"Blinkit Ads {path} kept failing ({last})")

    async def optional(self, path: str, body: dict | None = None):
        """Secondary data (insights, collections): a failure must not fail the sync."""
        try:
            return await self.call(path, body)
        except AdsError as e:
            if e.code in ("login_required", "rate_limited", "blocked", "captcha"):
                raise
            return {"error": str(e)}


async def collect_account(api: AdsApi) -> dict:
    adv = await api.call("/adservice/v1/advertisers")
    config = (await api.optional("/adservice/v3/campaigns/config")).get("data") or {}
    return {
        "cities": config.get("cities") or {},  # region id → city name, for campaign targeting
        "fetchedAt": int(time.time()),
        "advertisers": adv.get("items") or [],
        "user": adv.get("user"),
        "festiveSummary": (await api.optional("/adservice/v1/festive/summary")).get("data"),
        "festiveKeywords": (await api.optional("/adservice/v1/festive/categories/keywords")).get("data"),
        "collections": ((await api.optional("/adservice/v1/brand-pages")).get("data") or {}).get("collections"),
        "plans": (await api.optional("/adservice/v1/plans")).get("data"),
    }


async def collect_campaigns(api: AdsApi, frm: date, to: date, details: str = "all") -> dict:
    """details: all | active (only campaigns with activity in the window or ACTIVE)."""
    res = await api.call("/adservice/v1/advertisers/campaigns",
                         {"from_date": portal_date(frm), "to_date": portal_date(to), "campaign_types": []})
    campaigns = (res.get("data") or {}).get("campaigns") or []
    out: dict = {"from": frm.isoformat(), "to": to.isoformat(), "campaigns": campaigns, "details": {}}
    for c in campaigns:
        busy = c.get("campaign_status") == "ACTIVE" or (c.get("budget_consumed") or 0) > 0 or (c.get("impressions") or 0) > 0
        if details == "all" or busy:
            d = await api.call(f"/adservice/v1/campaigns/{int(c['id'])}")
            out["details"][str(c["id"])] = (d.get("data") or {}).get("campaign")
    return out


def active_campaign_ids(campaigns: dict) -> list[int]:
    return [int(c["id"]) for c in campaigns["campaigns"] if (c.get("budget_consumed") or 0) > 0 or (c.get("impressions") or 0) > 0]


async def collect_daily(api: AdsApi, campaign_ids: list[int], frm: date, to: date) -> dict:
    series: dict[str, dict[str, dict]] = {}
    for cid in campaign_ids:
        per_day: dict[str, dict] = {}
        for i in range(0, len(DAILY_METRICS), 2):
            res = await api.call(f"/adservice/v1/campaigns/metrics-trends/{cid}", {
                "metrics": DAILY_METRICS[i:i + 2], "from_date": portal_date(frm), "to_date": portal_date(to), "campaign_types": ALL_TYPES})
            for pt in res.get("data") or []:
                day = str(pt.get("date_ist", ""))[:10]
                if day:
                    per_day.setdefault(day, {}).update({k: v for k, v in pt.items() if k != "date_ist"})
        series[str(cid)] = per_day
    return {"from": frm.isoformat(), "to": to.isoformat(), "metrics": DAILY_METRICS, "campaigns": series}


async def collect_keywords(api: AdsApi, daily: dict, frm: date, to: date) -> dict:
    """Keyword / breakdown reports per campaign per day, only for days with spend."""
    out = []
    for cid, per_day in daily["campaigns"].items():
        for d in days(frm, to):
            m = per_day.get(d.isoformat()) or {}
            if not (m.get("budget_consumed") or m.get("impressions")):
                continue
            res = await api.call(f"/adservice/v1/campaigns/reports/{cid}", {"from_date": portal_date(d), "to_date": portal_date(d)})
            data = res.get("data") or {}
            out.append({"campaignId": cid, "date": d.isoformat(), "reporting": data.get("reporting") or {"keyword": data.get("reports") or []}})
    return {"from": frm.isoformat(), "to": to.isoformat(), "days": out}


Step = tuple[str, str, Callable[[], Awaitable[dict]]]


def plan(api: AdsApi, mode: str, today: date | None = None) -> list[Step]:
    """Sync steps in order. full = 1 year of daily data + 30 days of keywords; recent = 14 / 7 days.
    Later steps read earlier results through `state`, so they must run in this order."""
    today = today or ist_today()
    # Routine sync refreshes only correction windows. Historical rows remain in QCP.
    # This cuts per-campaign API calls sharply while retaining late attribution updates.
    daily_from = today - timedelta(365 if mode == "full" else 7)
    kw_from = today - timedelta(30 if mode == "full" else 3)
    state: dict = {}

    async def account():
        return await collect_account(api)

    async def campaigns():
        state["campaigns"] = await collect_campaigns(api, daily_from, today, "all" if mode == "full" else "active")
        return state["campaigns"]

    def need(key: str):
        if key not in state:
            raise AdsError("api_error", f"skipped: the {key} step failed earlier in this sync")
        return state[key]

    async def daily():
        need("campaigns")
        state["daily"] = await collect_daily(api, active_campaign_ids(state["campaigns"]), daily_from, today)
        return state["daily"]

    async def keywords():
        return await collect_keywords(api, need("daily"), kw_from, today)

    return [
        ("ads_account", "Ad account, wallet & insights", account),
        ("ads_campaigns", f"Campaigns since {daily_from.isoformat()}", campaigns),
        ("ads_daily", "Daily campaign performance", daily),
        ("ads_keywords", f"Keyword performance since {kw_from.isoformat()}", keywords),
    ]
