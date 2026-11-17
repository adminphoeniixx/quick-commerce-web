"""QCP browser MCP server (stdio).

Connects with Playwright over CDP to the dedicated Chrome started by start_chrome.sh,
where the user is logged in to their seller panels. Downloads triggered through
`browser_click_download` are saved and uploaded straight to the QCP database.
"""
import asyncio
import json
import os
import re
import time
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP
from playwright.async_api import Page, async_playwright

from qcp_api import QcpClient, default_target

HERE = Path(__file__).resolve().parent
import sys
sys.path.insert(0, str(HERE.parent / "services" / "browser"))  # shared Blinkit Ads collector
# Lets the server run standalone (e.g. from Claude Code); run.py already passes its env.
load_dotenv(HERE / ".env")
# httpx logs full request URLs at INFO, which would leak magic-link tokens.
import logging
logging.getLogger("httpx").setLevel(logging.WARNING)
DOWNLOADS = HERE / "downloads"
# Chrome's own download folder, used when a download arrives without CDP events.
CHROME_DOWNLOADS = Path(os.environ.get("CHROME_DOWNLOAD_DIR", Path.home() / "Downloads"))
CDP_URL = os.environ.get("CHROME_CDP_URL", "http://127.0.0.1:9222")

PLATFORM_HOSTS = {
    "blinkit.com": "blinkit", "grofers.com": "blinkit", "zeptonow.com": "zepto",
    "swiggy.com": "instamart", "bigbasket.com": "bigbasket",
}
# Test-only extra hosts (e.g. "127.0.0.1"), mapped to platform "blinkit".
EXTRA_HOSTS = [h for h in os.environ.get("QCP_EXTRA_ALLOWED_HOSTS", "").split(",") if h]

SNAPSHOT_JS = """(maxText) => {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  // An open modal/drawer blocks the page behind it: only expose what is inside it.
  const overlays = [...document.querySelectorAll(".ant-modal-wrap,.ant-drawer-open,[role=dialog],[aria-modal=true]")]
    .filter((o) => visible(o) && getComputedStyle(o).visibility !== "hidden");
  const scope = overlays.length ? overlays[overlays.length - 1] : document;
  document.querySelectorAll("[data-qcp-ref]").forEach((el) => el.removeAttribute("data-qcp-ref"));
  const sel = "a,button,input,select,textarea,[role=button],[role=tab],[role=option],[role=menuitem],[role=checkbox],[onclick],.ant-modal-close,[class~=cursor-pointer]";
  const elements = []; let n = 0;
  for (const el of scope.querySelectorAll(sel)) {
    if (!visible(el) || n >= 300) continue;
    const ref = `e${++n}`;
    el.setAttribute("data-qcp-ref", ref);
    elements.push({
      ref, tag: el.tagName.toLowerCase(), role: el.getAttribute("role") || undefined, type: el.type || undefined,
      text: (el.innerText || el.value || el.getAttribute("aria-label") || el.title || "").trim().slice(0, 80) || undefined,
      placeholder: el.placeholder || undefined, href: el.href ? el.href.slice(0, 200) : undefined,
      actionId: el.getAttribute("data-action-id") || undefined,
      disabled: el.disabled || el.getAttribute("aria-disabled") === "true" || undefined,
    });
  }
  const text = (document.body?.innerText || "").replace(/\\n{2,}/g, "\\n").trim();
  const low = (text.slice(0, 5000) + " " + document.title).toLowerCase();
  return {
    url: location.href, title: document.title,
    flags: {
      blocked: /access denied|you have been blocked|attention required|cloudflare ray id/.test(low),
      captcha: !!document.querySelector("iframe[src*='captcha'],iframe[src*='turnstile'],.g-recaptcha,.h-captcha") || /verify you are human/.test(low),
      loginPage: !!document.querySelector("input[type=password]") || /enter otp|send otp|login to continue|sign in to continue|request sign in link/.test(low)
        // brands.blinkit.com shows its marketing page with a "Log In" button when logged out.
        || (location.hostname === "brands.blinkit.com" && [...document.querySelectorAll("button")].some((b) => visible(b) && /^log ?in$/i.test(b.innerText.trim()))),
    },
    modal: scope === document ? undefined : { text: scope.innerText.slice(0, 1500) },
    text: text.slice(0, maxText), elements,
  };
}"""

mcp = FastMCP("qcp-browser")
_state: dict = {"pw": None, "browser": None, "tabs": {}, "next_id": 1, "downloads": {}}
_clients: dict[str, QcpClient] = {}


def qcp(target: str = "") -> QcpClient:
    """QCP API client for the "live" or "local" panel (default: QCP_TARGET in agent/.env)."""
    t = (target or default_target()).strip().lower()
    if t not in _clients:
        _clients[t] = QcpClient(t)
    return _clients[t]


def platform_for(url: str) -> str | None:
    try:
        u = urlparse(url)
    except ValueError:
        return None
    host = u.hostname or ""
    if u.scheme == "https":
        for h, p in PLATFORM_HOSTS.items():
            if host == h or host.endswith("." + h):
                return p
    if host in EXTRA_HOSTS:
        return "blinkit"
    return None


async def context():
    if not _state["browser"] or not _state["browser"].is_connected():
        _state["pw"] = _state["pw"] or await async_playwright().start()
        try:
            _state["browser"] = await _state["pw"].chromium.connect_over_cdp(CDP_URL)
        except Exception as e:
            raise RuntimeError(f"Chrome is not running with remote debugging at {CDP_URL}. Run agent/start_chrome.sh first. ({e})")
        await watch_downloads(_state["browser"])
    return _state["browser"].contexts[0]


async def watch_downloads(browser) -> None:
    # Playwright's download events don't fire for an attached (CDP) browser, so
    # route downloads into DOWNLOADS ourselves and track them by guid.
    DOWNLOADS.mkdir(exist_ok=True)
    cdp = await browser.new_browser_cdp_session()
    downloads: dict = _state["downloads"]

    def begin(e):
        downloads[e["guid"]] = {"name": e["suggestedFilename"], "url": e["url"], "state": "inProgress", "at": time.time()}

    def progress(e):
        if e["guid"] in downloads and e["state"] != "inProgress":
            downloads[e["guid"]]["state"] = e["state"]

    cdp.on("Browser.downloadWillBegin", begin)
    cdp.on("Browser.downloadProgress", progress)
    await cdp.send("Browser.setDownloadBehavior", {"behavior": "allowAndName", "downloadPath": str(DOWNLOADS), "eventsEnabled": True})
    _state["cdp"] = cdp


def tab_id(page: Page) -> int:
    for i, p in _state["tabs"].items():
        if p is page:
            return i
    i = _state["next_id"]
    _state["next_id"] += 1
    _state["tabs"][i] = page
    return i


async def seller_page(tid: int) -> Page:
    page = _state["tabs"].get(tid)
    if not page or page.is_closed():
        raise ValueError(f"Unknown tab {tid}; call browser_list_tabs")
    if not platform_for(page.url):
        raise ValueError("Tab is not an allowed seller panel")
    return page


# The agent only reads and downloads: never press buttons that change seller data.
FORBIDDEN_CLICK = re.compile(r"\b(save|submit|delete|remove|publish|deactivate|activate|archive|edit|update|pay|withdraw|send|raise|request callback)\b", re.I)


async def safe_click(page: Page, ref: str) -> None:
    loc = page.locator(f'[data-qcp-ref="{ref}"]')
    if not await loc.count():
        raise ValueError(f"ref {ref} not found; take a new browser_snapshot")
    meta = await loc.evaluate("el => ({ text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim(), disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true' })")
    if FORBIDDEN_CLICK.search(meta["text"]):
        raise ValueError(f"Refusing to click '{meta['text'][:40]}': the agent never changes seller data")
    if meta["disabled"]:
        raise ValueError(f"'{meta['text'][:40]}' is disabled; something else must be selected first")
    try:
        await loc.click(timeout=6000)
    except Exception as e:
        if "intercepts pointer events" in str(e):
            raise ValueError("A popup/overlay is blocking the page: take a browser_snapshot and close it (e.g. 'Got it' / 'Close') first")
        raise ValueError(f"Click failed: {str(e).splitlines()[0]}")


def newest_chrome_download(since: float) -> Path | None:
    if not CHROME_DOWNLOADS.is_dir():
        return None
    files = [f for f in CHROME_DOWNLOADS.iterdir()
             if f.is_file() and f.stat().st_mtime >= since and not f.name.endswith((".crdownload", ".tmp")) and not f.name.startswith(".")]
    return max(files, key=lambda f: f.stat().st_mtime) if files else None


def out(value) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


@mcp.tool()
async def browser_list_tabs() -> str:
    """List open seller-panel tabs (Blinkit, Zepto, Instamart, BigBasket) in the agent Chrome."""
    ctx = await context()
    return out([{"tabId": tab_id(p), "url": p.url, "title": await p.title(), "platform": platform_for(p.url)}
                for p in ctx.pages if platform_for(p.url)])


@mcp.tool()
async def browser_open(url: str) -> str:
    """Open a seller-panel URL, reusing a tab on the same site if one is open. Allowed seller domains only."""
    if not platform_for(url):
        raise ValueError(f"URL not allowed: {url}")
    ctx = await context()
    host = urlparse(url).hostname
    page = next((p for p in ctx.pages if urlparse(p.url).hostname == host), None) or await ctx.new_page()
    await page.goto(url, wait_until="domcontentloaded", timeout=60000)
    await page.bring_to_front()
    return out({"tabId": tab_id(page), "url": page.url})


BRANDS_URL = "https://brands.blinkit.com/"
LINK_REQUEST_COOLDOWN_S = 120


def is_blinkit_host(host: str) -> bool:
    return host == "blinkit.com" or host.endswith(".blinkit.com")


async def brands_page() -> Page:
    ctx = await context()
    page = next((p for p in ctx.pages if (urlparse(p.url).hostname or "") == "brands.blinkit.com"), None)
    if not page:
        page = await ctx.new_page()
        await page.goto(BRANDS_URL, wait_until="domcontentloaded", timeout=60000)
    return page


async def brands_logged_in(page: Page) -> bool:
    await page.wait_for_timeout(1500)
    snap = await page.evaluate(SNAPSHOT_JS, 500)
    return not snap["flags"]["loginPage"]


@mcp.tool()
async def blinkit_brands_request_login_link(email: str) -> str:
    """Blinkit Brands (brands.blinkit.com, Blinkit Ads) step 1: enter the user's email and press
    "Request Sign in Link". Blinkit then emails a sign-in URL; the user must paste it to
    blinkit_brands_login_magic_link. Returns {alreadyLoggedIn: true} if the session is still valid."""
    email = email.strip()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise ValueError("Invalid email")
    last = _state.get("link_requested_at", 0)
    if time.time() - last < LINK_REQUEST_COOLDOWN_S:
        raise ValueError(f"A sign-in link was requested {int(time.time() - last)}s ago; check the inbox before asking again")

    page = await brands_page()
    await page.goto(BRANDS_URL, wait_until="domcontentloaded", timeout=60000)
    await page.bring_to_front()
    if await brands_logged_in(page):
        return out({"tabId": tab_id(page), "alreadyLoggedIn": True, "url": page.url})

    email_input = page.locator("input[type=email]").first
    if not await email_input.is_visible():
        await page.get_by_role("button", name=re.compile(r"^log ?in$", re.I)).first.click(timeout=10000)
        await email_input.wait_for(state="visible", timeout=10000)
    await email_input.fill(email)
    keep = page.get_by_role("checkbox").first  # "Keep me signed in": keeps the profile session long-lived
    if await keep.count() and await keep.get_attribute("aria-checked") != "true" and await keep.get_attribute("data-state") != "checked":
        await keep.click()
    api: list = []

    async def on_response(resp):
        req = resp.request
        if req.method != "GET" and req.resource_type in ("xhr", "fetch"):
            try:
                body = (await resp.text())[:200]
            except Exception:
                body = ""
            api.append({"path": urlparse(resp.url).path, "status": resp.status, "body": body})

    page.on("response", on_response)
    try:
        await page.get_by_role("button", name=re.compile(r"request sign in link", re.I)).click(timeout=10000)
        await page.wait_for_timeout(2500)
    finally:
        page.remove_listener("response", on_response)
    _state["link_requested_at"] = time.time()
    # Blinkit shows a short-lived toast ("link sent" / an error); poll so it isn't missed.
    toast = None
    for _ in range(16):
        await page.wait_for_timeout(250)
        toast = await page.evaluate("""() => [...document.querySelectorAll('[role=alert],[role=status],[class*=toast],[class*=Toast],[class*=snackbar],[class*=notification]')]
            .map(e => e.innerText.trim()).filter(Boolean).join(' | ').slice(0, 300)""")
        if toast:
            break
    snap = await page.evaluate(SNAPSHOT_JS, 500)
    return out({"tabId": tab_id(page), "requested": True, "email": email,
                "toast": toast or None, "api": api,
                "pageSays": (snap.get("modal") or {}).get("text") or snap["text"][:200],
                "next": "Ask the user to paste the sign-in URL from the Blinkit email, then call blinkit_brands_login_magic_link."})


@mcp.tool()
async def blinkit_brands_login_magic_link(magic_link: str) -> str:
    """Blinkit Brands step 2: open the sign-in URL from the Blinkit email in the agent Chrome.
    The URL is a one-time credential: it is never stored and never returned. Use only a link the user supplied."""
    try:
        parsed = urlparse(magic_link.strip())
    except ValueError:
        raise ValueError("Invalid magic link")
    host = parsed.hostname or ""
    magic_link = magic_link.strip()
    if parsed.scheme == "https" and host.endswith(".ct.sendgrid.net"):
        # Blinkit's email wraps the link in SendGrid click tracking: read the redirect target
        # (without following it, so the Blinkit token is not consumed) and validate that instead.
        import httpx
        async with httpx.AsyncClient(timeout=20, follow_redirects=False) as http:
            r = await http.get(magic_link)
        target = r.headers.get("location", "")
        if not r.is_redirect or not target:
            raise ValueError(f"SendGrid link did not redirect (HTTP {r.status_code}); the link may be expired")
        magic_link, parsed = target, urlparse(target)
        host = parsed.hostname or ""
    if parsed.scheme != "https" or not is_blinkit_host(host):
        raise ValueError(f"Magic link must be an https://…blinkit.com URL (got host {host!r}). "
                         "If the email wraps it in a tracking link, open it once in a browser and copy the final blinkit.com URL.")
    page = await brands_page()
    await page.goto(magic_link, wait_until="domcontentloaded", timeout=90000)
    await page.wait_for_timeout(4000)
    final_host = urlparse(page.url).hostname or ""
    if not is_blinkit_host(final_host):
        raise ValueError("The link redirected outside blinkit.com")
    await page.bring_to_front()
    logged_in = await brands_logged_in(page)
    # Deliberately omit page.url: a redirect can retain the secret token.
    return out({"tabId": tab_id(page), "loggedIn": logged_in, "host": final_host, "title": await page.title(),
                **({} if logged_in else {"reason": "Still on the login page: the link may be expired or already used. Request a new one."})})


@mcp.tool()
async def blinkit_ads_sync(mode: str = "recent", brand_id: str = "", target: str = "") -> str:
    """Pull the logged-in Blinkit Ads account (brands.blinkit.com) into the QCP admin: wallet, insights,
    every campaign, daily performance (recent = 14 days, full = 1 year) and keyword reports
    (7 / 30 days). Read-only on Blinkit. brand_id defaults to the target's brand. target: "live" |
    "local" QCP panel (default QCP_TARGET). Requires a Blinkit Ads login in the agent Chrome
    (blinkit_brands_login_magic_link)."""
    import blinkit_ads as ads
    if mode not in ("recent", "full"):
        raise ValueError("mode must be recent or full")
    page = await brands_page()
    api = ads.AdsApi(page)
    reports, steps, failed = [], [], None
    for kind, label, fn in ads.plan(api, mode):
        t = time.time()
        try:
            reports.append({"type": kind, "data": await fn()})
            steps.append({"step": label, "ok": True, "seconds": round(time.time() - t, 1)})
        except ads.AdsError as e:
            steps.append({"step": label, "ok": False, "reason": str(e)})
            failed = failed or {"code": e.code, "reason": str(e)}
            if e.code in ("login_required", "blocked"):
                break  # nothing later can work without a session
    # Import whatever completed: a failed keyword step must not throw away campaigns and daily data.
    result = {}
    if reports:
        result = await qcp(target).import_ads(reports, brand_id or None)
    return out({"synced": failed is None, "target": qcp(target).target, "mode": mode, "apiCalls": api.calls, "steps": steps,
                **({"failure": failed} if failed else {}), "qcp": result.get("results")})


# ── blinkit.com search SEO for Blinkit Ads keywords (services/browser/blinkit_search.py) ─
# Runs in the agent Chrome's normal tab. On top of the module's guardrails (max 10 keywords,
# 8s pause, stop on block/captcha/429) the MCP allows 2 runs per city per day.
KW_RUNS_PER_DAY = 2
KW_STATE = HERE / "downloads" / "keyword_runs.json"


def _kw_runs(city: str) -> int:
    try:
        return json.loads(KW_STATE.read_text()).get(time.strftime("%Y-%m-%d"), {}).get(city, 0)
    except (OSError, ValueError):
        return 0


def _kw_mark(city: str) -> None:
    day = time.strftime("%Y-%m-%d")
    try:
        runs = json.loads(KW_STATE.read_text())
    except (OSError, ValueError):
        runs = {}
    today = runs.get(day, {})
    today[city] = today.get(city, 0) + 1
    KW_STATE.parent.mkdir(exist_ok=True)
    KW_STATE.write_text(json.dumps({day: today}))


PAUSE_FILE = HERE / "downloads" / "blinkit_pause.json"  # set when blinkit.com blocks this laptop's IP


def _local_pause() -> str | None:
    try:
        until = float(json.loads(PAUSE_FILE.read_text()).get("until", 0))
    except (OSError, ValueError):
        return None
    if until <= time.time():
        return None
    return f"blinkit.com blocked this computer's IP; all searches are paused until {time.strftime('%d %b %H:%M', time.localtime(until))} to protect it"


def _set_local_pause(reason: str) -> None:
    PAUSE_FILE.parent.mkdir(exist_ok=True)
    PAUSE_FILE.write_text(json.dumps({"until": time.time() + 24 * 3600, "reason": reason}))


async def blinkit_public_page() -> Page:
    ctx = await context()
    page = next((p for p in ctx.pages if (urlparse(p.url).hostname or "") == "blinkit.com"), None)
    return page or await ctx.new_page()


@mcp.tool()
async def blinkit_location_suggestions(query: str) -> str:
    """blinkit.com's own delivery-area suggestions for `query` (e.g. "Sector 50 Gurugram"), numbered,
    without changing the location. Pass the right number as `pick` to blinkit_set_location or
    blinkit_keyword_rank when the first suggestion is not the area you mean."""
    import blinkit_search as bs
    if _local_pause():
        raise ValueError(_local_pause())
    page = await blinkit_public_page()
    try:
        items = await bs.location_suggestions(page, query)
    except bs.SearchError as e:
        raise ValueError(str(e))
    return out({"query": query, "suggestions": [{"pick": i, "area": t} for i, t in enumerate(items)]})


@mcp.tool()
async def blinkit_set_location(query: str, pick: int = 0) -> str:
    """Change the blinkit.com delivery location in the agent Chrome (e.g. "T Nagar Chennai",
    "Sector 50 Gurugram") so blinkit_keyword_rank reads that area. Chooses suggestion number `pick`
    (0 = first; list them with blinkit_location_suggestions)."""
    import blinkit_search as bs
    if _local_pause():
        raise ValueError(_local_pause())
    page = await blinkit_public_page()
    try:
        loc = await bs.set_location(page, query, pick)
    except bs.SearchError as e:
        raise ValueError(str(e))
    return out({"location": loc, "city": bs.city_of(loc)})


@mcp.tool()
async def blinkit_keyword_rank(top: int = 10, keywords: list[str] | None = None, location: str = "", save: bool = True,
                               target: str = "", pick: int = 0) -> str:
    """SEO check on blinkit.com for the brand's Blinkit Ads keywords. Takes the `top` keywords by ad
    sales from QCP (run blinkit_ads_sync first) unless `keywords` is given, searches each one and
    records every product card: position, organic position, brand, rating + rating count, AD tag +
    ad campaign, price/MRP, stock. `location` (area + city) sets the delivery location first; empty
    uses the agent Chrome's current one. save=True imports into QCP Keyword Intelligence
    ("Blinkit search SEO"). target: "live" | "local" QCP panel (default QCP_TARGET); keywords and the
    daily limit come from that panel. `pick` chooses which blinkit.com area suggestion `location`
    uses (see blinkit_location_suggestions). Max 10 keywords per run, 2 runs per city per day (panel
    and MCP runs together); stops on any block."""
    import blinkit_search as bs
    if _local_pause():
        return out({"synced": False, "code": "paused", "reason": _local_pause()})
    client = qcp(target)
    status = {}
    try:  # same keyword list and daily counter as the panel's "Sync SEO now"
        status = await client.get("/api/seo/sync")
    except Exception:
        pass
    # Block protection: the panel's pause / daily total apply to the laptop runs as well.
    if status.get("paused") or status.get("searchPaused"):
        return out({"synced": False, "code": "paused", "reason": status.get("paused") or status.get("searchPaused")})
    if status.get("limitTotalPerDay") and (status.get("totalToday") or 0) >= status["limitTotalPerDay"]:
        return out({"synced": False, "code": "daily_limit", "reason": f"blinkit.com search already ran {status['totalToday']}x today (all cities); limit {status['limitTotalPerDay']} a day. Try tomorrow."})
    if not keywords and status.get("keywords"):
        keywords = list(status["keywords"])
    if not keywords:
        rows = (await client.get("/api/ads/keywords")).get("rows") or []
        # The ads keyword report also carries recommendation placements (matchType PLACEMENT): not searches.
        rows = sorted((r for r in rows if str(r.get("matchType") or "").upper() != "PLACEMENT"),
                      key=lambda r: (r.get("sales") or 0, r.get("spend") or 0), reverse=True)
        keywords = [str(r.get("keyword") or "") for r in rows]
    keywords = [k for k in keywords if re.search(r"[a-z]", str(k).lower())][:max(1, min(top, bs.MAX_KEYWORDS))]
    page = await blinkit_public_page()
    await page.bring_to_front()
    # Check the daily cap before searching: resolve the city the run will use.
    if location.strip():
        try:
            city = bs.city_of(await bs.set_location(page, location, pick))
        except bs.SearchError as e:
            return out({"synced": False, "code": e.code, "reason": str(e)})
        location = ""  # already set
    else:
        await page.goto(bs.HOME, wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(2000)
        city = bs.city_of(await bs.current_location(page))
    alias = {"gurugram": "gurgaon", "gurgaon": "gurugram", "bengaluru": "bangalore", "bangalore": "bengaluru"}
    names = {city.lower(), alias.get(city.lower(), "")} - {""}
    panel_runs = max([int(n) for c, n in (status.get("runsToday") or {}).items() if c.lower() in names] or [0])
    if max(_kw_runs(city), panel_runs) >= KW_RUNS_PER_DAY:
        raise ValueError(f"blinkit.com search already ran {KW_RUNS_PER_DAY}x today for {city}; try tomorrow or another city")
    _kw_mark(city)
    try:
        payload = await bs.search_keywords(page, keywords, location)
    except bs.SearchError as e:
        if e.code in ("blocked", "captcha"):
            _set_local_pause(str(e))
        return out({"synced": False, "code": e.code, "reason": str(e) + (" Searches from this computer are paused for 24h." if e.code in ("blocked", "captcha") else "")})
    DOWNLOADS.mkdir(exist_ok=True)
    raw = DOWNLOADS / f"{time.strftime('%Y%m%d-%H%M%S')}_blinkit_search_{re.sub(r'[^A-Za-z0-9]+', '_', payload['city'])}.json"
    raw.write_text(json.dumps(payload, ensure_ascii=False))
    imported = None
    if save and payload["results"]:
        try:
            imported = await client.import_search(payload)
        except Exception as e:
            imported = {"error": str(e)}
    return out({"target": client.target, "panel": client.base, "city": payload["city"], "location": payload["location"],
                "results": {r["keyword"]: len(r["products"]) for r in payload["results"]},
                "rawFile": str(raw), "qcp": imported, "next": "See Keyword Intelligence → Blinkit search SEO in QCP"})


@mcp.tool()
async def blinkit_seller_seo_sync(period: str = "Last 30 days", brand_id: str = "", target: str = "") -> str:
    """Pull listing / SEO data for every product from the logged-in Blinkit Seller Hub
    (seller.blinkit.com) into QCP's Keyword Intelligence tab: catalogue content (title, description,
    customer-facing attributes, images), expansion level, availability %, live/closed dark stores
    and cities with the per-city breakdown, sales and complaints for `period`
    ("Last 7 days" | "Last 30 days" | "Current Month"). Read-only on Blinkit. brand_id defaults
    to the target's brand; target: "live" | "local" QCP panel (default QCP_TARGET). Requires the
    Seller Hub login in the agent Chrome. Run blinkit_ads_sync too: QCP joins each product with the
    ad keywords that sell it."""
    import blinkit_seller_seo as seo
    if period not in ("Last 7 days", "Last 30 days", "Current Month"):
        raise ValueError("period must be Last 7 days, Last 30 days or Current Month")
    ctx = await context()
    page = next((p for p in ctx.pages if (urlparse(p.url).hostname or "") == "seller.blinkit.com"), None) or await ctx.new_page()
    api = seo.SellerApi(page)
    t = time.time()
    try:
        payload = await seo.collect_listing_seo(api, period)
    except seo.SellerError as e:
        return out({"synced": False, "code": e.code, "reason": str(e), "apiCalls": api.calls})
    DOWNLOADS.mkdir(exist_ok=True)  # raw copy, so QCP can be re-imported without calling Blinkit again
    raw = DOWNLOADS / f"{time.strftime('%Y%m%d-%H%M%S')}_blinkit_seller_seo.json"
    raw.write_text(json.dumps(payload, ensure_ascii=False))
    client = qcp(target)
    result = await client.import_seo(payload, brand_id or None)
    return out({"synced": True, "target": client.target, "panel": client.base, "apiCalls": api.calls, "seconds": round(time.time() - t),
                "products": len(payload["products"]), "rawFile": str(raw), "qcp": result})


@mcp.tool()
async def blinkit_ads_bids(product: str = "", active_only: bool = True, target: str = "") -> str:
    """Every Blinkit Ads keyword bid from the QCP panel (synced by blinkit_ads_sync): per campaign,
    each keyword × match type with its current CPM, period impressions / spend / sales / ROAS / avg
    slot, and any bid change waiting for approval. `product` filters by product name (or id).
    Read-only. target: "live" | "local" panel (default QCP_TARGET)."""
    client = qcp(target)
    data = await client.get(f"/api/ads/bids?brandId={client.brand_id}" + ("&active=1" if active_only else ""))
    want = product.strip().lower()
    rows = []
    for c in data.get("campaigns") or []:
        names = [p.get("name") or p.get("productId") for p in c.get("products") or []]
        if want and not any(want in str(n).lower() or want == str(p.get("productId")) for n, p in zip(names, c.get("products") or [])):
            continue
        for k in c.get("keywords") or []:
            for b in k.get("bids") or []:
                perf = b.get("perf") or {}
                rows.append({"campaignId": c["campaignId"], "campaign": c["name"], "status": c["status"], "products": names,
                             "keyword": k["keyword"], "matchType": b["matchType"], "cpm": b.get("cpm"),
                             "impressions": perf.get("impressions"), "spend": perf.get("spend"), "sales": perf.get("sales"),
                             "roas": round(perf["roas"], 2) if perf.get("roas") is not None else None, "avgSlot": perf.get("position"),
                             "pendingChange": (b.get("open") or {}).get("toCpm"), "pendingStatus": (b.get("open") or {}).get("status")})
    return out({"target": client.target, "range": data.get("range"), "limits": data.get("limits"), "bids": rows[:300], "count": len(rows),
                "next": "Propose with blinkit_ads_propose_bids; the seller approves in QCP → Ads → Bids, then QCP applies them"})


@mcp.tool()
async def blinkit_ads_propose_bids(changes: list[dict], target: str = "") -> str:
    """Propose new Blinkit Ads keyword bids in QCP: [{campaignId, keyword, matchType: EXACT|SMART,
    toCpm, note?}]. CPM must be ₹50–₹2000. Nothing changes on Blinkit until the seller approves
    them in QCP → Ads → Bids; QCP then applies them with its Blinkit Ads session and verifies each.
    This tool can never approve. target: "live" | "local" panel (default QCP_TARGET)."""
    client = qcp(target)
    clean = [{"campaignId": str(c["campaignId"]), "keyword": str(c["keyword"]), "matchType": str(c.get("matchType", "EXACT")).upper(),
              "toCpm": int(round(float(c["toCpm"]))), **({"note": str(c["note"])[:300]} if c.get("note") else {})} for c in changes]
    res = await client.post("/api/ads/bids/changes", {"changes": clean})
    return out({"target": client.target, **res, "approve": f"{client.base}/dashboard/ads/bids"})


@mcp.tool()
async def browser_snapshot(tab_id: int, max_text: int = 6000) -> str:
    """Read a tab: url, title, visible text and interactive elements with a `ref` for click/fill.
    If flags.blocked, flags.captcha or flags.loginPage is true, stop and report to the user."""
    page = await seller_page(tab_id)
    await page.wait_for_load_state("domcontentloaded")
    return out(await page.evaluate(SNAPSHOT_JS, max(500, min(max_text, 20000))))


@mcp.tool()
async def browser_click(tab_id: int, ref: str) -> str:
    """Click an element by ref from the latest browser_snapshot. For report downloads use browser_click_download."""
    page = await seller_page(tab_id)
    await safe_click(page, ref)
    return out({"clicked": ref})


@mcp.tool()
async def browser_fill(tab_id: int, ref: str, value: str) -> str:
    """Type a value into an input or choose a <select> option by ref. Never for passwords or OTPs."""
    page = await seller_page(tab_id)
    loc = page.locator(f'[data-qcp-ref="{ref}"]')
    meta = await loc.evaluate("el => (el.type || '') + ' ' + el.name + ' ' + el.id + ' ' + (el.placeholder || '') + ' ' + el.tagName")
    if "password" in meta.lower() or "otp" in meta.lower():
        raise ValueError("Refusing to fill password/OTP fields")
    if meta.strip().endswith("SELECT"):
        await loc.select_option(label=value)
    else:
        await loc.fill(value[:200])
    return out({"filled": ref})


@mcp.tool()
async def browser_wait(ms: int) -> str:
    """Wait 250-15000 ms for the page to update."""
    ms = max(250, min(ms, 15000))
    await asyncio.sleep(ms / 1000)
    return out({"waited": ms})


@mcp.tool()
async def browser_click_download(tab_id: int, ref: str, data_type: str, timeout_s: int = 180) -> str:
    """Click a Download/Export element and upload the resulting file to the QCP database.
    data_type: products (catalog) | sales | availability (inventory/stock) | pricing | visibility
    | ads (Blinkit Brands / ad campaign reports: saved to agent/downloads only, QCP has no ads import yet)."""
    page = await seller_page(tab_id)
    platform = platform_for(page.url)
    downloads: dict = _state["downloads"]
    before = set(downloads)
    clicked_at = time.time() - 1
    await safe_click(page, ref)

    # Reports are often generated server-side first, so the file can take a while.
    deadline = time.time() + timeout_s
    guid, src, name = None, None, None
    while time.time() < deadline:
        new = [g for g in downloads if g not in before]
        if new:
            guid = new[0]
            if downloads[guid]["state"] == "completed":
                src, name = DOWNLOADS / guid, downloads[guid]["name"]
                break
            if downloads[guid]["state"] == "canceled":
                return out({"uploaded": False, "reason": "download canceled", "name": downloads[guid]["name"]})
        elif (f := newest_chrome_download(clicked_at)):
            await asyncio.sleep(1)  # let Chrome finish the rename
            src, name = f, f.name
            break
        await asyncio.sleep(0.5)
    if not src:
        return out({"uploaded": False, "reason": f"no download within {timeout_s}s (the report may be emailed or still generating)"})

    safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in name)
    path = DOWNLOADS / f"{time.strftime('%Y%m%d-%H%M%S')}_{platform}_{safe}"
    src.rename(path) if src.parent == DOWNLOADS else path.write_bytes(src.read_bytes())
    result = {"file": str(path), "platform": platform, "data_type": data_type}
    if data_type == "ads":
        return out({**result, "uploaded": False, "reason": "saved locally; QCP has no ads import yet"})
    if path.suffix.lower() not in (".csv", ".xlsx"):
        return out({**result, "uploaded": False, "reason": "only .csv/.xlsx can be imported"})
    try:
        result.update(uploaded=True, qcp=await qcp().upload(path, platform, data_type))
    except Exception as e:
        result.update(uploaded=False, reason=str(e))
    return out(result)


if __name__ == "__main__":
    mcp.run()
