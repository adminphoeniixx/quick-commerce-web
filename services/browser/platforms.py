"""Per-platform knowledge: where login starts, how to tell we're logged in, and the
deterministic report download used by scheduled syncs."""
import asyncio
import re
from dataclasses import dataclass
from typing import Awaitable, Callable
import json
from urllib.parse import unquote, urlparse

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError


class SyncError(Exception):
    """code: login_required | blocked | captcha | ui_changed | no_download"""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


BLOCK_TEXT = re.compile(r"access denied|you have been blocked|attention required|cloudflare ray id", re.I)
CAPTCHA_SEL = "iframe[src*='captcha'],iframe[src*='turnstile'],iframe[src*='challenges.cloudflare.com'],.g-recaptcha,.h-captcha"


async def page_flags(page: Page) -> dict:
    text = (await page.evaluate("() => (document.body?.innerText || '').slice(0, 5000) + ' ' + document.title")) or ""
    return {
        "blocked": bool(BLOCK_TEXT.search(text)),
        "captcha": await page.locator(CAPTCHA_SEL).count() > 0 or "verify you are human" in text.lower(),
        "loginForm": await page.locator("input[type=password], input[autocomplete='one-time-code']").count() > 0,
    }


@dataclass
class Platform:
    slug: str
    login_url: str
    allowed_hosts: tuple[str, ...]

    def host_allowed(self, url: str) -> bool:
        host = urlparse(url).hostname or ""
        return url.startswith(("about:", "data:", "blob:")) or any(host == h or host.endswith("." + h) for h in self.allowed_hosts)

    async def logged_in(self, page: Page) -> bool:
        raise NotImplementedError

    async def open_sales(self, page: Page) -> None:
        raise NotImplementedError

    async def sales_ranges(self, page: Page, mode: str) -> list[str]:
        raise NotImplementedError

    async def download_sales(self, page: Page, range_label: str) -> tuple[str, bytes]:
        raise NotImplementedError

    async def download_catalog(self, page: Page) -> tuple[str, bytes]:
        raise NotImplementedError

    async def download_inventory(self, page: Page) -> tuple[str, bytes]:
        raise NotImplementedError

    async def plan_sync(self, page: Page, body) -> list[tuple[str, str | None, str, Callable[[], Awaitable[tuple[str, bytes]]]]]:
        """Ordered sync steps: (type, range, label, fn returning (fileName, bytes))."""
        raise NotImplementedError


async def ensure_session(page: Page, platform: "Platform") -> None:
    flags = await page_flags(page)
    if flags["blocked"]:
        raise SyncError("blocked", f"{platform.slug} blocked this browser")
    if flags["captcha"]:
        raise SyncError("captcha", f"{platform.slug} is showing a captcha")
    if not await platform.logged_in(page):
        raise SyncError("login_required", f"{platform.slug} session expired; reconnect")


class Blinkit(Platform):
    SALES_URL = "https://seller.blinkit.com/dashboard/performance?performance=sales_performance"
    SALES_BUTTON = '[data-action-id="performance:sales_analytics:download_sales_report"]'

    def __init__(self) -> None:
        # Login may bounce through Zomato-group auth pages; everything else is refused.
        super().__init__("blinkit", "https://seller.blinkit.com/", ("blinkit.com", "grofers.com", "zomato.com"))

    async def logged_in(self, page: Page) -> bool:
        u = urlparse(page.url)
        if u.hostname != "seller.blinkit.com" or not u.path.startswith("/dashboard"):
            return False
        return not (await page_flags(page))["loginForm"]

    async def dismiss_popups(self, page: Page) -> None:
        # Informational modals ("Be cautious of third parties…") cover the page.
        for _ in range(3):
            modal = page.locator(".ant-modal-wrap:visible")
            if not await modal.count():
                return
            btn = modal.last.get_by_role("button", name=re.compile(r"^(got it|close|okay|ok)$", re.I))
            if await btn.count():
                await btn.first.click(timeout=5000)
            else:
                await page.keyboard.press("Escape")
            await page.wait_for_timeout(800)

    RANGE_TEXT = re.compile(r"^(Current Month|Last \d+ days|[A-Z][a-z]+ \d{4})$")
    MONTH = re.compile(r"^[A-Z][a-z]+ \d{4}$")
    CATALOG_URL = "https://seller.blinkit.com/dashboard/catalogue?catalog_tab=active"
    INVENTORY_URL = "https://seller.blinkit.com/dashboard/inventory?inventory=stock_in_hand"

    async def open_sales(self, page: Page) -> None:
        await page.goto(self.SALES_URL, wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(4000)
        await ensure_session(page, self)
        await self.dismiss_popups(page)

    async def _range_trigger(self, page: Page):
        trigger = page.get_by_text(self.RANGE_TEXT).first
        if not await trigger.count():
            raise SyncError("ui_changed", "Date range selector not found on the Blinkit sales page")
        return trigger

    async def sales_ranges(self, page: Page, mode: str) -> list[str]:
        if mode == "recent":
            # Last 30 days overlaps Current Month and doubled routine import work.
            return ["Current Month"]
        # "full": every month the panel offers plus the current month.
        trigger = await self._range_trigger(page)
        await trigger.click()
        await page.wait_for_timeout(800)
        # The menu is a plain list of labels; collect every visible range label.
        items: list[str] = []
        for el in await page.get_by_text(self.RANGE_TEXT).all():
            t = (await el.inner_text()).strip()
            if await el.is_visible() and t not in items:
                items.append(t)
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(500)
        months = [t for t in items if self.MONTH.match(t)]
        return ["Current Month", *months]

    async def _select_range(self, page: Page, label: str) -> None:
        trigger = await self._range_trigger(page)
        if (await trigger.inner_text()).strip() == label:
            return
        await trigger.click()
        await page.wait_for_timeout(800)
        # The trigger shows the current label, so the menu entry is the last match.
        item = page.get_by_text(label, exact=True)
        if not await item.count() or not await item.last.is_visible():
            await page.keyboard.press("Escape")
            raise SyncError("range_unavailable", f"Range '{label}' is not offered by Blinkit")
        await item.last.click()
        await page.wait_for_timeout(3000)
        if (await trigger.inner_text()).strip() != label:
            raise SyncError("ui_changed", f"Could not switch the sales range to '{label}'")

    # Signed report links Blinkit hands out when a report is ready.
    REPORT_HOSTS = (".amazonaws.com",)

    @classmethod
    def _ready_url(cls, data: dict) -> str | None:
        for key, value in data.items():
            if key.lower().endswith("url") and isinstance(value, str) and value.startswith("https://"):
                host = urlparse(value).hostname or ""
                if host.endswith(cls.REPORT_HOSTS):
                    return value
        return None

    async def _await_download(self, page: Page, click, poll_hint: str, timeout_s: int = 180) -> tuple[str, bytes]:
        """Click, then wait until Blinkit's poll says FAILED or hands out the file link.

        The panel normally navigates to a signed S3 link; the connector's navigation guard
        blocks that, so the file is fetched straight from the link instead. A regular
        browser download is accepted too, whichever comes first.
        """
        outcome = asyncio.get_running_loop().create_future()

        async def on_response(resp):
            if poll_hint not in resp.url or outcome.done():
                return
            try:
                data = (await resp.json()).get("data") or {}
            except Exception:
                return
            if data.get("status") == "FAILED" and not outcome.done():
                outcome.set_result(("failed", None))
            elif (url := self._ready_url(data)) and not outcome.done():
                outcome.set_result(("url", url))

        def on_download(dl):
            if not outcome.done():
                outcome.set_result(("download", dl))

        handler = lambda r: asyncio.create_task(on_response(r))
        page.on("response", handler)
        page.on("download", on_download)
        try:
            await click()
            try:
                kind, value = await asyncio.wait_for(outcome, timeout=timeout_s)
            except TimeoutError:
                raise SyncError("no_download", f"Blinkit did not finish the report within {timeout_s // 60} minutes (try again later)")
            if kind == "failed":
                raise SyncError("report_failed", "Blinkit could not generate this report (try again later)")
            if kind == "download":
                path = await value.path()
                return value.suggested_filename, open(path, "rb").read()
            resp = await page.context.request.get(value, timeout=120_000)
            if not resp.ok:
                raise SyncError("no_download", f"Report link returned HTTP {resp.status}")
            name = unquote(urlparse(value).path.rsplit("/", 1)[-1]) or "report.xlsx"
            return name, await resp.body()
        finally:
            page.remove_listener("response", handler)
            page.remove_listener("download", on_download)

    async def download_sales(self, page: Page, range_label: str) -> tuple[str, bytes]:
        await self.dismiss_popups(page)
        await self._select_range(page, range_label)
        await self.dismiss_popups(page)
        button = page.locator(f"{self.SALES_BUTTON}:visible")
        if not await button.count():
            button = page.locator("button:visible").filter(has_text=re.compile(r"^reports$", re.I))
        if not await button.count():
            raise SyncError("ui_changed", "Sales 'Reports' button not found on the Blinkit performance page")
        button = button.first
        await button.wait_for(state="visible", timeout=10_000)
        if await button.is_disabled():
            raise SyncError("report_unavailable", "Sales 'Reports' button is disabled; Blinkit is not ready to generate this report")
        await button.scroll_into_view_if_needed()

        async def click_report() -> None:
            try:
                await button.click(timeout=15_000)
            except PlaywrightTimeoutError:
                # Blinkit occasionally leaves a transparent modal backdrop after changing
                # the date range. Re-check known popups, then click the verified visible button.
                await self.dismiss_popups(page)
                if not await button.is_visible() or await button.is_disabled():
                    raise SyncError("ui_changed", "Sales 'Reports' button became unavailable before download")
                await button.click(timeout=10_000, force=True)

        return await self._await_download(page, click_report, "/api/reports/poll")

    async def download_catalog(self, page: Page) -> tuple[str, bytes]:
        await page.goto(self.CATALOG_URL, wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(5000)
        await ensure_session(page, self)
        await self.dismiss_popups(page)
        select_all = page.locator(".ant-table-thead .ant-checkbox-input, .ant-table-header .ant-checkbox-input")
        if not await select_all.count():
            raise SyncError("ui_changed", "Catalog select-all checkbox not found")
        await select_all.first.check(force=True)
        await page.wait_for_timeout(800)
        bulk = page.get_by_role("button", name=re.compile(r"^bulk download$", re.I))
        if not await bulk.count() or await bulk.first.is_disabled():
            raise SyncError("ui_changed", "Catalog 'Bulk Download' button not available")
        return await self._await_download(page, lambda: bulk.first.click(timeout=10_000), "dashboard-products/download/status")

    async def download_inventory(self, page: Page) -> tuple[str, bytes]:
        """Inventory → Bulk reports → Download Stock on Hand (item × warehouse)."""
        await page.goto(self.INVENTORY_URL, wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(5000)
        await ensure_session(page, self)
        await self.dismiss_popups(page)
        menu = page.get_by_text("Bulk reports", exact=True)
        if not await menu.count():
            raise SyncError("ui_changed", "Inventory 'Bulk reports' button not found")
        await menu.first.click()
        await page.wait_for_timeout(1000)
        item = page.get_by_text("Download Stock on Hand", exact=True)
        if not await item.count():
            raise SyncError("ui_changed", "'Download Stock on Hand' option not found")
        # The file link comes from POST /api/s3/get-url ({"presigned_url": …}).
        return await self._await_download(page, lambda: item.first.click(timeout=10_000), "s3/get-url")


    async def plan_sync(self, page: Page, body):
        steps = []
        if getattr(body, "sales", True):
            await self.open_sales(page)
            ranges = body.ranges or await self.sales_ranges(page, body.mode)
            steps += [("sales_summary", r, f"Sales report · {r}", lambda r=r: self.download_sales(page, r)) for r in ranges]
        # blinkit.com search is the public storefront (no seller login), so it runs first and an
        # expired Seller Hub login then only fails the listing step instead of the whole job.
        search = getattr(body, "search", None)
        searching = bool(search and search.keywords)
        if searching:
            label = f"blinkit.com search · {search.location or 'current location'}"
            steps.append(("search_seo", search.location or None, label, lambda: self.search_seo(page, search.keywords, search.location)))
        if getattr(body, "seo", True):
            steps.append(("listing_seo", None, "Listing SEO (content, stores, availability)", lambda: self.listing_seo(page, fatal=not searching)))
        if body.catalog:
            steps.append(("product_listing", None, "Product list (catalog)", lambda: self.download_catalog(page)))
        if body.inventory:
            steps.append(("stock_on_hand", None, "Stock on hand (inventory)", lambda: self.download_inventory(page)))
        return steps


    async def listing_seo(self, page: Page, fatal: bool = True) -> tuple[str, bytes]:
        """Seller Hub catalogue content + expansion + sales per product (blinkit_seller_seo.py).
        fatal=False: a lost seller login only fails this step (the public search data is kept)."""
        import blinkit_seller_seo as seo
        try:
            payload = await seo.collect_listing_seo(seo.SellerApi(page))
        except seo.SellerError as e:
            code = e.code if fatal or e.code != "login_required" else "seller_login_required"
            raise SyncError(code, "Listing SEO needs the Blinkit seller login (reconnect on Connections)" if code == "seller_login_required" else str(e))
        return "listing_seo.json", json.dumps(payload, ensure_ascii=False).encode()

    async def search_seo(self, page: Page, keywords: list[str], location: str) -> tuple[str, bytes]:
        """blinkit.com search results for the brand's ad keywords (blinkit_search.py)."""
        import blinkit_search as bs
        try:
            payload = await bs.search_keywords(page, keywords, location)
        except bs.SearchError as e:
            # A block on the public site must not mark the seller login as broken.
            raise SyncError("search_" + e.code, str(e))
        return "search_seo.json", json.dumps(payload, ensure_ascii=False).encode()


class BlinkitAds(Platform):
    """brands.blinkit.com (Blinkit Ads / Brand Central). Login is an emailed sign-in link."""

    def __init__(self) -> None:
        super().__init__("blinkit-ads", "https://brands.blinkit.com/", ("blinkit.com", "grofers.com"))

    async def logged_in(self, page: Page) -> bool:
        u = urlparse(page.url)
        if u.hostname != "brands.blinkit.com" or not u.path.startswith("/dashboard"):
            return False
        # Logged out, the portal shows its marketing page with a "Log In" button.
        return not await page.get_by_role("button", name=re.compile(r"^log ?in$", re.I)).count()

    async def plan_sync(self, page: Page, body):
        import blinkit_ads as ads
        api = ads.AdsApi(page)
        try:
            await api.authenticate()
        except ads.AdsError as e:
            raise SyncError(e.code, str(e))

        def wrap(kind: str, fn):
            async def run() -> tuple[str, bytes]:
                try:
                    payload = await fn()
                except ads.AdsError as e:
                    raise SyncError(e.code, str(e))
                return f"{kind}.json", json.dumps(payload, ensure_ascii=False).encode()
            return run

        bids = getattr(body, "bids", None)
        if bids:  # approved bid changes: only this step, no data sync
            import blinkit_ads_bids as ab
            changes = [b.model_dump() for b in bids]
            return [("ads_bids", None, f"Apply {len(changes)} approved bid change(s)", wrap("ads_bids", lambda: ab.apply_bids(api, changes)))]
        campaign_action = getattr(body, "campaign_action", None)
        if campaign_action:
            import blinkit_ads_campaigns as ac
            change = campaign_action.model_dump(exclude_none=True)
            label = f"{change['action'].title()} campaign {change['campaign_id']}"
            return [("ads_campaign_action", None, label, wrap("ads_campaign_action", lambda: ac.apply_campaign_action(api, change)))]
        return [(kind, None, label, wrap(kind, fn)) for kind, label, fn in ads.plan(api, body.mode)]


PLATFORMS: dict[str, Platform] = {"blinkit": Blinkit(), "blinkit-ads": BlinkitAds()}
