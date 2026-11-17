"""Blinkit Seller Hub (seller.blinkit.com) listing / SEO collector.

Reads the seller's own catalogue and performance data through the same JSON endpoints the
Seller Hub pages call, inside the logged-in page (same session, same origin). Read-only:
only GET/listing queries the dashboard itself makes, throttled, never any create/edit call.

collect_listing_seo() returns one JSON payload that QCP ingests (lib/seo/ingest.ts):
  products      catalogue content per product: title, description, attributes, images, category
  attributes    customer-facing attributes each primary category supports (for completeness)
  expansion     per product: expansion level, availability %, sales per store, complaints,
                live / closed dark stores and cities, and the per-city breakdown
  sales         units and value per product for the last 30 days
  complaints    complaint reasons per product for the last 30 days
"""
import asyncio
import time
from urllib.parse import urlencode

BASE = "https://seller.blinkit.com"
API = "/seller-hub/api"
LANDING = BASE + "/dashboard/performance?performance=product_expansion"
THROTTLE_S = 0.6
MAX_PAGES = 30  # hard stop for any paginated list
# Request headers the Seller Hub SPA attaches to its own API calls; reused, never stored.
AUTH_HEADERS = ("access_token", "x-api-key", "x-gr-seller-id", "app_client")

FETCH_JS = """async ([path, body, headers]) => {
  const r = await fetch(path, { method: body ? "POST" : "GET", credentials: "include",
    headers: { ...headers, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch (e) {}
  return { status: r.status, json };
}"""


class SellerError(Exception):
    """code: login_required | blocked | api_error"""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class SellerApi:
    def __init__(self, page):
        self.page = page
        self.headers: dict | None = None
        self.calls = 0

    async def authenticate(self) -> None:
        page = self.page
        got = asyncio.get_running_loop().create_future()

        def on_request(req):
            h = req.headers
            if API in req.url and h.get("access_token") and not got.done():
                got.set_result({k: h[k] for k in AUTH_HEADERS if h.get(k)})

        page.on("request", on_request)
        try:
            await page.goto(LANDING, wait_until="domcontentloaded", timeout=60000)
            try:
                self.headers = await asyncio.wait_for(got, 25)
            except TimeoutError:
                text = (await page.evaluate("() => (document.body?.innerText || '').slice(0, 3000)")).lower()
                if "access denied" in text or "you have been blocked" in text:
                    raise SellerError("blocked", "Blinkit Seller Hub blocked this browser")
                raise SellerError("login_required", "Blinkit Seller Hub session expired; log in again in the agent Chrome")
        finally:
            page.remove_listener("request", on_request)

    async def call(self, path: str, body: dict | None = None, params: dict | None = None):
        if not self.headers:
            await self.authenticate()
        url = API + path + (("?" + urlencode(params)) if params else "")
        reauthed, last, rate_limited = False, "no response", False
        for attempt in range(4):
            await asyncio.sleep(THROTTLE_S)
            self.calls += 1
            try:
                r = await self.page.evaluate(FETCH_JS, [url, body, self.headers])
            except Exception as e:
                last = str(e).splitlines()[0][:120]
                await asyncio.sleep(3 * (attempt + 1))
                continue
            status = r["status"]
            if status in (401, 403):
                if reauthed:
                    raise SellerError("login_required", "Blinkit Seller Hub session expired; log in again")
                reauthed = True
                await self.authenticate()
                continue
            if status == 429:
                # Blinkit says "too many requests": wait once, then stop the whole run (QCP pauses
                # this connection for a day). Hammering through a 429 is how accounts get blocked.
                if rate_limited:
                    raise SellerError("rate_limited", "Blinkit said too many requests (HTTP 429); stopped to protect the account")
                rate_limited = True
                await asyncio.sleep(60)
                continue
            if status >= 500:
                last = f"HTTP {status}"
                await asyncio.sleep(min(60, 5 * 2 ** attempt))
                continue
            if status >= 400:
                raise SellerError("api_error", f"Seller Hub {path} returned HTTP {status}")
            j = r["json"] or {}
            return j.get("data", j) if isinstance(j, dict) else j
        raise SellerError("api_error", f"Seller Hub {path} kept failing ({last})")

    async def optional(self, path: str, body: dict | None = None, params: dict | None = None):
        try:
            return await self.call(path, body, params)
        except SellerError as e:
            if e.code != "api_error":
                raise
            return {"error": str(e)}


async def _pages(fetch, key: str, page_size: int) -> list:
    rows: list = []
    for page in range(MAX_PAGES):
        data = await fetch(page) or {}
        batch = data.get(key) or []
        rows += batch
        total = data.get("total_count") or 0
        if not batch or len(rows) >= total or len(batch) < page_size:
            break
    return rows


async def collect_listing_seo(api: SellerApi, period: str = "Last 30 days") -> dict:
    started = time.time()
    expansion = await _pages(lambda p: api.call("/product_expansion/performance/list",
                             params={"page": p, "sort_by": "gmv", "filtering_enabled": "true", "limit": 10}), "products", 10)
    sales = await _pages(lambda p: api.call("/sales/products/performance",
                         {"filters": {"time_range_filter": period}, "order_by": "-sales", "page": p}), "product_sales_performance", 10)
    complaints = await _pages(lambda p: api.optional("/complaints/performance/products",
                              {"filters": {"time_range_filter": period}, "order_by": "-id", "page": p}), "products", 10)

    products, cities, categories = {}, {}, {}
    for row in expansion:
        d = row.get("detail") or {}
        pid, item = d.get("product_id"), d.get("item_id")
        if not pid:
            continue
        p = await api.optional("/catalog/retrieve-product", params={"product_id": pid})
        if isinstance(p, dict) and "error" not in p:
            products[str(pid)] = {k: p.get(k) for k in (
                "id", "item_id", "name", "brand", "unit", "description", "details", "tags", "mrp", "price",
                "selling_price", "food_type", "image_count", "categories", "attributes", "sliding_images",
                "feature_images", "highlight_images", "has_feed_image", "override_listing_name", "current_state",
                "activation_state", "enabled_flag")}
            products[str(pid)]["attributes"] = [
                {"id": a.get("id"), "key": a.get("name"), "name": a.get("display_text") or a.get("name"), "type": a.get("attribute_type"),
                 "value": a.get("value"), "group": (a.get("group") or {}).get("display_text")}
                for a in p.get("attributes") or [] if isinstance(a, dict)]
            for c in p.get("categories") or []:
                if c.get("is_primary"):
                    categories.setdefault(str(c["id"]), c.get("name"))
        if item:
            cities[str(pid)] = await _pages(lambda pg, item=item: api.call(
                f"/product_expansion/performance/details/{item}",
                params={"page": pg, "sort_by": "gmv", "filtering_enabled": "true", "aggregation": "CITY",
                        "item_ids": item, "limit": 10}), "cities", 10)

    attributes = {}
    for cid in categories:
        a = await api.optional(f"/catalog/category/{cid}/attributes")
        rows = (a.get("results") or a.get("attributes")) if isinstance(a, dict) else a
        if isinstance(rows, list):
            attributes[cid] = [{"id": x.get("id"), "key": x.get("name"), "name": x.get("display_text") or x.get("name"),
                                "type": x.get("attribute_type"), "mandatory": bool(x.get("is_mandatory")),
                                "group": (x.get("group") or {}).get("display_text"), "help": (x.get("help_text") or "")[:160]}
                               for x in rows if isinstance(x, dict) and x.get("attribute_type") == "shown_to_customer"]

    return {"fetchedAt": int(time.time()), "period": period, "seconds": round(time.time() - started),
            "expansion": expansion, "cities": cities, "sales": sales, "complaints": complaints,
            "products": products, "categories": categories, "attributes": attributes}
