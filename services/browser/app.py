"""QCP browser service (internal only).

Runs one persistent Chrome profile per platform connection. The QCP app uses it to
1) show a live, remote-controlled login window ("Connect Blinkit"), and
2) download reports on a schedule with the saved session.

No stealth, no captcha solving, no credential storage: the user logs in themselves and
the service only keeps the browser profile (cookies) on a private volume.
"""
import asyncio
import base64
import os
import re
import shutil
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse, Response
from playwright.async_api import BrowserContext, Page, Playwright, async_playwright
from pydantic import BaseModel, Field

from platforms import PLATFORMS, Platform, SyncError, page_flags

TOKEN = os.environ.get("BROWSER_SERVICE_TOKEN", "")
PROFILE_DIR = Path(os.environ.get("PROFILE_DIR", "/data/profiles"))
HEADLESS = os.environ.get("BROWSER_HEADLESS", "false").lower() == "true"
MAX_BROWSERS = int(os.environ.get("MAX_BROWSERS", "3"))
IDLE_SECONDS = int(os.environ.get("LIVE_SESSION_IDLE_SECONDS", "600"))
VIEWPORT = {"width": 1280, "height": 800}
FATAL = {"login_required", "blocked", "captcha", "rate_limited"}
ALLOWED_KEYS = {"Enter", "Backspace", "Delete", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"}


class Live:
    def __init__(self, ctx: BrowserContext, page: Page, platform: Platform):
        self.ctx, self.page, self.platform, self.used = ctx, page, platform, time.time()


state: dict = {"pw": None, "live": {}, "locks": {}, "jobs": {}}
slots = asyncio.Semaphore(MAX_BROWSERS)
# Every platform here is a Blinkit site behind the same Cloudflare and the same server IP: run one
# Blinkit sync at a time (seller, Ads, bids, blinkit.com search), never several in parallel.
blinkit_session = asyncio.Lock()


def lock_for(cid: str) -> asyncio.Lock:
    return state["locks"].setdefault(cid, asyncio.Lock())


def check_cid(cid: str) -> str:
    if not re.fullmatch(r"\d{1,20}", cid):
        raise HTTPException(400, "invalid connection id")
    return cid


def platform_of(slug: str) -> Platform:
    p = PLATFORMS.get(slug)
    if not p:
        raise HTTPException(400, f"platform {slug} is not supported")
    return p


async def auth(x_service_token: str = Header("")) -> None:
    if not TOKEN or x_service_token != TOKEN:
        raise HTTPException(401, "unauthorized")


async def open_context(cid: str, platform: Platform) -> tuple[BrowserContext, Page]:
    profile = PROFILE_DIR / cid
    profile.mkdir(parents=True, exist_ok=True)
    # A previous container can leave Chrome's profile lock behind; the per-connection
    # asyncio lock guarantees this service has no other browser on this profile.
    for name in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
        try:
            (profile / name).unlink()
        except FileNotFoundError:
            pass
    pw: Playwright = state["pw"]
    ctx = await pw.chromium.launch_persistent_context(
        str(profile), headless=HEADLESS, viewport=VIEWPORT, accept_downloads=True, args=["--no-first-run"],
    )

    # The remote window must not become a general-purpose browser: refuse top-level
    # navigation outside the platform's own domains and close stray popups.
    async def guard(route, request):
        try:
            main_nav = request.is_navigation_request() and request.frame == request.frame.page.main_frame
        except Exception:
            main_nav = False
        if main_nav and not platform.host_allowed(request.url):
            # 204 keeps the current page instead of showing "This site can't be reached".
            await route.fulfill(status=204, body="")
        else:
            await route.continue_()

    await ctx.route("**/*", guard)
    page = ctx.pages[0] if ctx.pages else await ctx.new_page()

    def on_page(p: Page) -> None:
        if p is not page:
            asyncio.create_task(p.close())

    ctx.on("page", on_page)
    return ctx, page


async def close_live(cid: str) -> None:
    live: Live | None = state["live"].pop(cid, None)
    if live:
        await live.ctx.close()
        slots.release()


async def reaper() -> None:
    while True:
        await asyncio.sleep(30)
        for cid, live in list(state["live"].items()):
            if time.time() - live.used > IDLE_SECONDS:
                await close_live(cid)


@asynccontextmanager
async def lifespan(_: FastAPI):
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    state["pw"] = await async_playwright().start()
    task = asyncio.create_task(reaper())
    yield
    task.cancel()
    for cid in list(state["live"]):
        await close_live(cid)
    await state["pw"].stop()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)


def live_or_404(cid: str) -> Live:
    live = state["live"].get(cid)
    if not live:
        raise HTTPException(404, "no live session; start one first")
    live.used = time.time()
    return live


@app.get("/health")
async def health():
    return {"ok": True, "live": len(state["live"])}


class StartBody(BaseModel):
    platform: str


@app.post("/sessions/{cid}/health-check", dependencies=[Depends(auth)])
async def session_health(cid: str, body: StartBody):
    """Lightweight saved-session check. No report download, clicks, or bypasses."""
    cid, platform = check_cid(cid), platform_of(body.platform)
    if not (PROFILE_DIR / cid).is_dir():
        return JSONResponse({"ok": False, "code": "login_required"}, status_code=422)
    # Keep-alive runs every 15 min: never queue behind a sync or an open login window (both keep the
    # session warm themselves) and never run beside another Blinkit browser (same IP, one at a time).
    lock = lock_for(cid)
    if cid in state["live"] or lock.locked() or blinkit_session.locked():
        return JSONResponse({"ok": False, "code": "busy"}, status_code=409)
    async with lock:
        async with blinkit_session, slots:
            ctx, page = await open_context(cid, platform)
            try:
                await page.goto(platform.login_url, wait_until="domcontentloaded", timeout=60000)
                await page.wait_for_timeout(3000)
                flags = await page_flags(page)
                if flags["blocked"] or flags["captcha"]:
                    code = "blocked" if flags["blocked"] else "captcha"
                    return JSONResponse({"ok": False, "code": code}, status_code=422)
                if platform.slug == "blinkit-ads":
                    import blinkit_ads as ads
                    try:
                        await ads.AdsApi(page).authenticate()
                    except ads.AdsError as e:
                        return JSONResponse({"ok": False, "code": e.code}, status_code=422)
                elif not await platform.logged_in(page):
                    return JSONResponse({"ok": False, "code": "login_required"}, status_code=422)
                return {"ok": True}
            finally:
                await ctx.close()


@app.post("/sessions/{cid}/start", dependencies=[Depends(auth)])
async def start(cid: str, body: StartBody):
    cid, platform = check_cid(cid), platform_of(body.platform)
    if cid in state["live"]:
        return {"started": True, "reused": True}
    lock = lock_for(cid)
    if lock.locked():
        raise HTTPException(409, "a sync is running for this connection; try again in a minute")
    try:
        await asyncio.wait_for(slots.acquire(), timeout=5)
    except TimeoutError:
        raise HTTPException(503, "all browser slots are busy; try again shortly")
    try:
        ctx, page = await open_context(cid, platform)
    except Exception:
        slots.release()
        raise
    state["live"][cid] = Live(ctx, page, platform)
    try:
        await page.goto(platform.login_url, wait_until="domcontentloaded", timeout=60000)
    except Exception:
        await close_live(cid)
        raise
    return {"started": True, "reused": False}


@app.get("/sessions/{cid}/frame", dependencies=[Depends(auth)])
async def frame(cid: str):
    live = live_or_404(check_cid(cid))
    try:
        jpeg = await live.page.screenshot(type="jpeg", quality=60)
    except Exception:
        # The window was closed (Stop / idle reaper) while this frame was being taken.
        raise HTTPException(404, "no live session; start one first")
    return Response(jpeg, media_type="image/jpeg", headers={"cache-control": "no-store"})


class InputBody(BaseModel):
    type: str = Field(pattern="^(click|type|key|scroll)$")
    x: float | None = Field(None, ge=0, le=VIEWPORT["width"])
    y: float | None = Field(None, ge=0, le=VIEWPORT["height"])
    text: str | None = Field(None, max_length=200)
    key: str | None = None
    dy: float | None = Field(None, ge=-3000, le=3000)


@app.post("/sessions/{cid}/input", dependencies=[Depends(auth)])
async def send_input(cid: str, body: InputBody):
    live = live_or_404(check_cid(cid))
    page = live.page
    if body.type == "click" and body.x is not None and body.y is not None:
        await page.mouse.click(body.x, body.y)
    elif body.type == "type" and body.text:
        await page.keyboard.type(body.text, delay=30)
    elif body.type == "key" and body.key in ALLOWED_KEYS:
        await page.keyboard.press(body.key)
    elif body.type == "scroll" and body.dy is not None:
        await page.mouse.wheel(0, body.dy)
    else:
        raise HTTPException(400, "invalid input")
    return {"ok": True}


@app.get("/sessions/{cid}/state", dependencies=[Depends(auth)])
async def session_state(cid: str):
    live = live_or_404(check_cid(cid))
    page = live.page
    try:
        return {
            "url": page.url.split("?")[0][:200],
            "loggedIn": await live.platform.logged_in(page),
            **(await page_flags(page)),
        }
    except Exception:
        # Closed, or mid-navigation (e.g. right after a sign-in link): report "not yet".
        if cid not in state["live"]:
            raise HTTPException(404, "no live session; start one first")
        return {"url": "", "loggedIn": False, "blocked": False, "captcha": False, "loginForm": False}


class LinkBody(BaseModel):
    url: str = Field(max_length=4096)


# Email click-tracking wrappers whose redirect target is read (never followed) first.
TRACKING_HOSTS = (".ct.sendgrid.net",)


@app.post("/sessions/{cid}/open-link", dependencies=[Depends(auth)])
async def open_link(cid: str, body: LinkBody):
    """Opens an emailed sign-in link (Blinkit Ads) in the live login window.
    The link is a one-time credential: it is never logged, stored or returned."""
    live = live_or_404(check_cid(cid))
    url = body.url.strip()
    host = urlparse(url).hostname or ""
    if url.startswith("https://") and host.endswith(TRACKING_HOSTS):
        resp = await live.ctx.request.get(url, max_redirects=0, timeout=20_000)
        target = resp.headers.get("location", "")
        if resp.status not in (301, 302, 303, 307, 308) or not target:
            raise HTTPException(400, "The email link did not redirect; it may have expired")
        url = target
    if not url.startswith("https://") or not live.platform.host_allowed(url):
        raise HTTPException(400, f"This is not a {live.platform.slug} sign-in link")
    await live.page.goto(url, wait_until="domcontentloaded", timeout=60000)
    await live.page.wait_for_timeout(4000)
    return {"opened": True, "loggedIn": await live.platform.logged_in(live.page)}


@app.post("/sessions/{cid}/stop", dependencies=[Depends(auth)])
async def stop(cid: str):
    await close_live(check_cid(cid))
    return {"stopped": True}


class SearchSpec(BaseModel):
    # blinkit.com search SEO for the brand's ad keywords (Blinkit seller connection only).
    keywords: list[str] = Field(default_factory=list, max_length=10)
    location: str = Field("", max_length=80)  # area + city to set as the delivery location; "" = keep current


class BidSpec(BaseModel):
    # One approved Blinkit Ads keyword bid change (QCP AdBidChange), applied by blinkit_ads_bids.py.
    id: str = Field(max_length=30)
    campaign_id: int
    keyword: str = Field(max_length=200)
    match_type: str = Field(pattern="^(EXACT|SMART)$")
    from_cpm: float | None = None
    to_cpm: float = Field(ge=50, le=2000)


class CampaignActionSpec(BaseModel):
    action: str = Field(pattern="^(stop|restart|update|duplicate)$")
    campaign_id: int = Field(gt=0)
    expected_status: str | None = Field(None, max_length=40)
    expected_budget: float | None = Field(None, ge=0)
    name: str | None = Field(None, min_length=1, max_length=160)
    budget: float | None = Field(None, gt=0, le=100_000_000)
    start: str | None = Field(None, max_length=30)
    end: str | None = Field(None, max_length=30)
    no_end: bool | None = None


class SyncBody(BaseModel):
    platform: str
    # full = every range the panel offers; recent = current month + last 30 days.
    mode: str = Field("recent", pattern="^(full|recent)$")
    ranges: list[str] | None = Field(None, max_length=12)  # explicit ranges (retry) override mode
    sales: bool = True
    catalog: bool = True
    inventory: bool = True
    seo: bool = True  # Seller Hub listing SEO (catalogue content, stores, availability)
    search: SearchSpec | None = None
    bids: list[BidSpec] | None = Field(None, max_length=200)  # Blinkit Ads only: apply these, nothing else
    campaign_action: CampaignActionSpec | None = None


# Syncs run as background jobs (a full sync can take many minutes); callers poll status.
PLATFORM_TITLES = {"blinkit": "Blinkit", "blinkit-ads": "Blinkit Ads"}
DEFAULT_STEP_SECONDS = 25  # estimate per report until real durations are known
IMPORT_SECONDS = 15        # time the QCP app needs to save the files afterwards
# blinkit.com search ≈ 16s per keyword (8s guard pause + page load); Seller Hub listing SEO ≈ 70s.
STEP_SECONDS = {
    "search_seo": lambda body: 16 * len(body.search.keywords) if body.search else DEFAULT_STEP_SECONDS,
    "listing_seo": lambda body: 70,
}


def public_job(job: dict) -> dict:
    steps = [{k: v for k, v in st.items() if k != "data"} for st in job["steps"]]
    done = [st for st in job["steps"] if st["status"] in ("ok", "failed") and st.get("finishedAt")]
    avg = sum(st["finishedAt"] - st["startedAt"] for st in done) / len(done) if done else DEFAULT_STEP_SECONDS
    remaining = [st for st in job["steps"] if st["status"] in ("pending", "running")]
    eta = None
    if job["status"] == "running":
        running = next((st for st in remaining if st["status"] == "running"), None)
        spent = time.time() - running["startedAt"] if running else 0
        left = sum(st.get("estSeconds", avg) for st in remaining)
        eta = max(5, int(left - spent + IMPORT_SECONDS)) if job["steps"] else None
    return {
        "id": job["id"], "status": job["status"], "activity": job["activity"], "startedAt": job["startedAt"],
        "finishedAt": job.get("finishedAt"), "elapsedSeconds": int((job.get("finishedAt") or time.time()) - job["startedAt"]),
        "etaSeconds": eta, "steps": steps, "error": job.get("error"),
    }


async def run_sync_job(cid: str, platform: Platform, body: "SyncBody", job: dict) -> None:
    site = PLATFORM_TITLES.get(platform.slug, platform.slug)

    async def run_step(st: dict, fn) -> None:
        st.update(status="running", startedAt=time.time())
        job["activity"] = f"Downloading {st['label']} from {site}…"
        try:
            try:
                name, data = await fn()
            except SyncError as e:
                # Blinkit's report builder fails intermittently; one delayed retry usually works.
                if e.code != "report_failed":
                    raise
                job["activity"] = f"{site} could not build {st['label']}; retrying in 20s…"
                await asyncio.sleep(20)
                job["activity"] = f"Retrying {st['label']}…"
                name, data = await fn()
            st.update(status="ok", fileName=name, data=base64.b64encode(data).decode())
        except SyncError as e:
            st.update(status="failed", code=e.code, error=str(e))
            if e.code in FATAL:
                raise
        finally:
            st["finishedAt"] = time.time()

    try:
        async with lock_for(cid):
            job["activity"] = "Waiting for a free browser…"
            async with blinkit_session, slots:
                ctx, page = await open_context(cid, platform)
                job["page"] = page
                try:
                    job["activity"] = f"Opening {site}…"
                    planned = []
                    for kind, rng, label, fn in await platform.plan_sync(page, body):
                        st = {"type": kind, "range": rng, "label": label, "status": "pending"}
                        if kind in STEP_SECONDS:  # long steps get their own estimate for the ETA
                            st["estSeconds"] = STEP_SECONDS[kind](body)
                        job["steps"].append(st)
                        planned.append((st, fn))
                    for st, fn in planned:
                        await run_step(st, fn)
                    ok = sum(st["status"] == "ok" for st in job["steps"])
                    job.update(status="done", activity=f"Downloaded {ok} of {len(job['steps'])} reports. Saving to QCP…")
                finally:
                    job.pop("page", None)
                    await ctx.close()
    except SyncError as e:
        job.update(status="error", error={"code": e.code, "message": str(e)}, activity=str(e))
    except Exception as e:  # unexpected: surface it instead of hanging the caller
        job.update(status="error", error={"code": "internal", "message": str(e)[:300]}, activity="Sync failed")
    finally:
        for st in job["steps"]:
            if st["status"] in ("pending", "running"):
                st.update(status="failed", error="not attempted")
        job["finishedAt"] = time.time()


@app.post("/sync/{cid}", dependencies=[Depends(auth)])
async def start_sync(cid: str, body: SyncBody):
    cid, platform = check_cid(cid), platform_of(body.platform)
    if cid in state["live"]:
        raise HTTPException(409, "the login window is open for this connection")
    # The public blinkit.com search needs no seller login, so an SEO sync may run on a missing/fresh
    # profile: the search runs and only the listing-SEO step fails (seller_login_required, not fatal).
    seo_sync = bool(body.search and body.search.keywords) and not (body.sales or body.catalog or body.inventory)
    if not seo_sync and not (PROFILE_DIR / cid).is_dir():
        return JSONResponse({"code": "login_required", "message": "not connected yet"}, status_code=422)
    current = state["jobs"].get(cid)
    if current and current["status"] == "running":
        raise HTTPException(409, "a sync is already running for this connection")
    job = {"id": uuid.uuid4().hex, "status": "running", "activity": "Starting…", "startedAt": time.time(), "steps": []}
    state["jobs"][cid] = job
    job["task"] = asyncio.create_task(run_sync_job(cid, platform, body, job))
    return {"jobId": job["id"]}


def job_or_404(cid: str) -> dict:
    job = state["jobs"].get(check_cid(cid))
    if not job:
        raise HTTPException(404, "no sync job for this connection")
    return job


@app.get("/sync/{cid}/status", dependencies=[Depends(auth)])
async def sync_status(cid: str):
    return public_job(job_or_404(cid))


@app.get("/sync/{cid}/result", dependencies=[Depends(auth)])
async def sync_result(cid: str):
    job = job_or_404(cid)
    if job["status"] == "running":
        raise HTTPException(409, "sync still running")
    if job["status"] == "error":
        return JSONResponse(job["error"], status_code=422)
    return {"reports": [
        {"type": st["type"], "range": st["range"], "status": st["status"], "fileName": st.get("fileName"),
         "data": st.get("data"), "code": st.get("code"), "error": st.get("error")}
        for st in job["steps"]
    ]}


@app.get("/sync/{cid}/frame", dependencies=[Depends(auth)])
async def sync_frame(cid: str):
    """Live view of what the sync browser is doing right now."""
    page = job_or_404(cid).get("page")
    if not page:
        raise HTTPException(404, "sync browser is not open")
    try:
        jpeg = await page.screenshot(type="jpeg", quality=45)
    except Exception:
        raise HTTPException(404, "sync browser is busy")
    return Response(jpeg, media_type="image/jpeg", headers={"cache-control": "no-store"})


@app.delete("/profiles/{cid}", dependencies=[Depends(auth)])
async def delete_profile(cid: str):
    cid = check_cid(cid)
    await close_live(cid)
    async with lock_for(cid):
        shutil.rmtree(PROFILE_DIR / cid, ignore_errors=True)
    return {"deleted": True}
