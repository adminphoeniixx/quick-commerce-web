"""blinkit.com search SEO for a brand's Blinkit Ads keywords.

Opens blinkit.com search in an already-open browser page (the agent Chrome via MCP, or the
browser service's connection profile) and reads the product cards from the page's own
/v1/layout/search responses: position, brand, rating + count, AD badge + ad campaign id,
price/MRP, stock. Shared by agent/browser_mcp.py and services/browser/platforms.py.

Guardrails: max 10 keywords per run, a fixed pause between searches, ~36 results per keyword,
and a hard stop on any block / captcha / 403 / 429. No proxies, no stealth, no IP rotation.
"""
import asyncio
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

MAX_KEYWORDS = 10
PAUSE_S = 8
MAX_RESULTS = 36
HOME = "https://blinkit.com/"
IST = timezone(timedelta(hours=5, minutes=30))

FLAGS_JS = """() => {
  const low = ((document.body?.innerText || '').slice(0, 5000) + ' ' + document.title).toLowerCase();
  return {
    blocked: /access denied|you have been blocked|attention required|cloudflare ray id/.test(low),
    captcha: !!document.querySelector("iframe[src*='captcha'],iframe[src*='turnstile'],.g-recaptcha,.h-captcha") || /verify you are human/.test(low),
  };
}"""

LOCATION_JS = """() => {
  const t = document.querySelector('header')?.innerText || document.body.innerText.slice(0, 400);
  const m = t.split('\\n').map(s => s.trim()).filter(Boolean);
  const i = m.findIndex(s => /^delivery in/i.test(s));
  return i >= 0 && m[i + 1] ? m[i + 1] : '';
}"""


class SearchError(Exception):
    """code: blocked | captcha | no_location | bad_input"""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _walk(o):
    if isinstance(o, dict):
        yield o
        for v in o.values():
            yield from _walk(v)
    elif isinstance(o, list):
        for v in o:
            yield from _walk(v)


def _txt(v):
    return v.get("text") if isinstance(v, dict) else v


def _money(v) -> float | None:
    m = re.search(r"[\d,.]+", str(_txt(v) or ""))
    return float(m.group().replace(",", "")) if m else None


def parse_search_products(payload: dict) -> list[dict]:
    """Product cards from Blinkit's /v1/layout/search response, in page order."""
    rows = []
    for node in _walk((payload.get("response") or {}).get("snippets", [])):
        data, tr = node.get("data"), (node.get("tracking") or {}).get("common_attributes")
        if not isinstance(data, dict) or not isinstance(tr, dict) or "product_id" not in (data.get("meta") or {}):
            continue
        bar = (data.get("rating") or {}).get("bar") or {}
        rows.append({
            "productId": str(data["meta"]["product_id"]), "name": _txt(data.get("name")) or tr.get("name"),
            "brand": _txt(data.get("brand_name")) or tr.get("brand"), "pack": _txt(data.get("variant")),
            "price": _money(data.get("normal_price")), "mrp": _money(data.get("mrp")),
            "rating": round(bar["value"], 1) if isinstance(bar.get("value"), (int, float)) else None,
            "ratingCount": _txt(bar.get("title")),
            "isAd": str(tr.get("badge") or "").upper() == "AD" or bool(tr.get("ads_campaign_id")),
            "adCampaignId": tr.get("ads_campaign_id") or None,
            "inventory": data.get("inventory"), "soldOut": bool(data.get("is_sold_out")),
        })
    return rows


async def _check(page) -> None:
    f = await page.evaluate(FLAGS_JS)
    if f["blocked"]:
        raise SearchError("blocked", "blinkit.com is showing a block page: stopping. Do not retry today.")
    if f["captcha"]:
        raise SearchError("captcha", "blinkit.com is asking for a captcha: stopping. Do not retry today.")


async def current_location(page) -> str:
    return await page.evaluate(LOCATION_JS)


def city_of(location: str) -> str:
    parts = [p.strip() for p in location.split(",") if p.strip()]
    return parts[-3] if len(parts) >= 3 else (parts[0] if parts else "")


async def _type_location(page, query: str):
    """Opens the delivery-location box, types the area and returns the suggestion rows."""
    query = query.strip()[:80]
    if len(query) < 3:
        raise SearchError("bad_input", "Give an area + city, e.g. 'Sector 50 Gurugram'")
    await page.goto(HOME, wait_until="domcontentloaded", timeout=60000)
    await page.wait_for_timeout(2500)
    await _check(page)
    box = page.get_by_placeholder(re.compile("search delivery location", re.I)).first
    if not await box.is_visible():
        await page.get_by_text(re.compile(r"^delivery in", re.I)).first.click(timeout=8000)
        await box.wait_for(state="visible", timeout=8000)
    await box.fill(query)
    rows = page.locator("[class*=LocationListContainer]")  # LocationSearchList__LocationListContainer-sc-…
    try:
        await rows.first.wait_for(state="visible", timeout=10000)
    except Exception:
        raise SearchError("no_location", f"blinkit.com found no location for '{query}'; try a more specific area")
    await page.wait_for_timeout(800)  # let the full list render
    return rows


async def location_suggestions(page, query: str) -> list[str]:
    """blinkit.com's own suggestions for an area (what its location box lists), without choosing one."""
    rows = await _type_location(page, query)
    texts = [re.sub(r"\s+", " ", t).strip() for t in await rows.all_inner_texts()]
    await page.keyboard.press("Escape")
    return [t for t in texts if t][:10]


async def set_location(page, query: str, pick: int = 0) -> str:
    """Types an area into blinkit.com's delivery-location box and picks suggestion number `pick`
    (0 = first; see location_suggestions)."""
    rows = await _type_location(page, query)
    n = await rows.count()
    if not 0 <= pick < n:
        raise SearchError("bad_input", f"pick must be 0..{n - 1} for '{query}'")
    await rows.nth(pick).click(timeout=8000)
    await page.wait_for_timeout(3000)
    return await current_location(page)


async def search_keywords(page, keywords: list[str], location: str = "", on_progress=None) -> dict:
    """Runs the searches. `location` (area + city) is set first when given, else the page's current one is used."""
    kws = []
    for k in keywords:
        k = re.sub(r"\s+", " ", str(k)).strip().lower()[:80]
        if k and k not in kws:
            kws.append(k)
    kws = kws[:MAX_KEYWORDS]
    if not kws:
        raise SearchError("bad_input", "No keywords to search")
    if location.strip():
        loc = await set_location(page, location)
    else:
        await page.goto(HOME, wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(2000)
        await _check(page)
        loc = await current_location(page)
    if not loc:
        raise SearchError("no_location", "No delivery location set on blinkit.com: give an area + city")

    results = []
    for i, kw in enumerate(kws):
        if on_progress:
            on_progress(i, len(kws), kw)
        if i:
            await asyncio.sleep(PAUSE_S)
        payloads: list[dict] = []
        status: list[int] = []

        async def on_response(resp):
            if "/v1/layout/search" in resp.url:
                status.append(resp.status)
                try:
                    payloads.append(await resp.json())
                except Exception:
                    pass

        page.on("response", on_response)
        try:
            await page.goto(f"{HOME}s/?q={quote(kw)}", wait_until="domcontentloaded", timeout=60000)
            await page.wait_for_timeout(4000)
            for _ in range(2):  # 12 cards per page; ~36 results is enough for an SEO position
                await page.mouse.wheel(0, 2500)
                await page.wait_for_timeout(1500)
        finally:
            page.remove_listener("response", on_response)
        if any(s in (403, 429) for s in status):
            raise SearchError("blocked", f"blinkit.com answered HTTP {max(status)} on '{kw}': stopping. Do not retry today.")
        await _check(page)
        products, seen = [], set()
        for p in payloads:
            for row in parse_search_products(p):
                if row["productId"] not in seen:
                    seen.add(row["productId"])
                    products.append(row)
        results.append({"keyword": kw, "products": products[:MAX_RESULTS]})
    return {"city": city_of(loc), "location": loc, "date": datetime.now(IST).date().isoformat(), "results": results}
