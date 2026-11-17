"""Minimal QCP API client: logs in with a QCP account (local or live panel) and imports data."""
import os
from pathlib import Path

import httpx

DATA_TYPES = ("products", "sales", "availability", "pricing", "visibility")


TARGETS = ("live", "local")


def default_target() -> str:
    t = os.environ.get("QCP_TARGET", "local").strip().lower()
    return t if t in TARGETS else "local"


class QcpClient:
    """target "local" uses QCP_URL / QCP_EMAIL / QCP_PASSWORD / QCP_BRAND_ID; "live" uses the
    QCP_LIVE_* versions of the same four (agent/.env; never committed)."""

    def __init__(self, target: str = "") -> None:
        self.target = (target or default_target()).strip().lower()
        if self.target not in TARGETS:
            raise ValueError(f"target must be one of {TARGETS}")
        p = "QCP_LIVE_" if self.target == "live" else "QCP_"
        missing = [p + k for k in ("URL", "EMAIL", "PASSWORD", "BRAND_ID") if not os.environ.get(p + k) and not (k == "URL" and p == "QCP_")]
        if missing:
            raise RuntimeError(f"Set {', '.join(missing)} in agent/.env to save to the {self.target} panel")
        self.base = os.environ.get(p + "URL", "http://localhost:3000").rstrip("/")
        self.email = os.environ[p + "EMAIL"]
        self.password = os.environ[p + "PASSWORD"]
        self.brand_id = os.environ[p + "BRAND_ID"]
        self.token: str | None = None

    async def _login(self, http: httpx.AsyncClient) -> None:
        r = await http.post(f"{self.base}/api/auth/login", json={"email": self.email, "password": self.password})
        r.raise_for_status()
        # Bearer auth skips the cookie CSRF check; the org comes from the login's org cookie.
        self.token = r.cookies.get("qcp_access")
        self.org_cookie = r.cookies.get("qcp_org")
        if not self.token:
            raise RuntimeError("QCP login did not return an access token")

    async def import_ads(self, reports: list[dict], brand_id: str | None = None) -> dict:
        """Blinkit Ads payloads (services/browser/blinkit_ads.py) → POST /api/ads/import."""
        async with httpx.AsyncClient(timeout=600) as http:
            for attempt in range(2):
                if not self.token or attempt:
                    await self._login(http)
                r = await http.post(
                    f"{self.base}/api/ads/import",
                    headers={"authorization": f"Bearer {self.token}"},
                    cookies={"qcp_org": self.org_cookie} if self.org_cookie else None,
                    json={"brandId": brand_id or self.brand_id, "reports": reports},
                )
                if r.status_code != 401:
                    break
            body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            if r.is_error:
                raise RuntimeError(body.get("message") or f"HTTP {r.status_code}")
            return body.get("data", {})

    async def get(self, path: str) -> dict:
        async with httpx.AsyncClient(timeout=60) as http:
            for attempt in range(2):
                if not self.token or attempt:
                    await self._login(http)
                r = await http.get(f"{self.base}{path}", headers={"authorization": f"Bearer {self.token}"},
                                   cookies={"qcp_org": self.org_cookie} if self.org_cookie else None)
                if r.status_code != 401:
                    break
            body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            if r.is_error:
                raise RuntimeError(body.get("message") or f"HTTP {r.status_code}")
            return body.get("data", {})

    async def post(self, path: str, payload: dict) -> dict:
        """JSON POST to a QCP API path (adds ?brandId= for the target's brand)."""
        sep = "&" if "?" in path else "?"
        async with httpx.AsyncClient(timeout=120) as http:
            for attempt in range(2):
                if not self.token or attempt:
                    await self._login(http)
                r = await http.post(f"{self.base}{path}{sep}brandId={self.brand_id}", headers={"authorization": f"Bearer {self.token}"},
                                    cookies={"qcp_org": self.org_cookie} if self.org_cookie else None, json=payload)
                if r.status_code != 401:
                    break
            body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            if r.is_error:
                raise RuntimeError(body.get("message") or f"HTTP {r.status_code}")
            return body.get("data", {})

    async def import_search(self, payload: dict, brand_id: str | None = None) -> dict:
        """blinkit.com search results for ad keywords → POST /api/seo/search/import."""
        async with httpx.AsyncClient(timeout=180) as http:
            for attempt in range(2):
                if not self.token or attempt:
                    await self._login(http)
                r = await http.post(f"{self.base}/api/seo/search/import", headers={"authorization": f"Bearer {self.token}"},
                                    cookies={"qcp_org": self.org_cookie} if self.org_cookie else None,
                                    json={"brandId": brand_id or self.brand_id, "payload": payload})
                if r.status_code != 401:
                    break
            body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            if r.is_error:
                raise RuntimeError(body.get("message") or f"HTTP {r.status_code}")
            return body.get("data", {})

    async def import_seo(self, payload: dict, brand_id: str | None = None) -> dict:
        """Seller Hub listing / SEO payload (services/browser/blinkit_seller_seo.py) → POST /api/seo/import."""
        async with httpx.AsyncClient(timeout=300) as http:
            for attempt in range(2):
                if not self.token or attempt:
                    await self._login(http)
                r = await http.post(
                    f"{self.base}/api/seo/import",
                    headers={"authorization": f"Bearer {self.token}"},
                    cookies={"qcp_org": self.org_cookie} if self.org_cookie else None,
                    json={"brandId": brand_id or self.brand_id, "payload": payload},
                )
                if r.status_code != 401:
                    break
            body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            if r.is_error:
                raise RuntimeError(body.get("message") or f"HTTP {r.status_code}")
            return body.get("data", {})

    async def upload(self, path: Path, platform: str, data_type: str) -> dict:
        if data_type not in DATA_TYPES:
            raise ValueError(f"QCP cannot import data_type={data_type!r} yet; file kept at {path}")
        async with httpx.AsyncClient(timeout=120) as http:
            for attempt in range(2):
                if not self.token or attempt:
                    await self._login(http)
                files = {"file": (path.name, path.read_bytes())}
                data = {"platform": platform, "dataType": data_type, "brandId": self.brand_id}
                r = await http.post(
                    f"{self.base}/api/imports",
                    headers={"authorization": f"Bearer {self.token}"},
                    cookies={"qcp_org": self.org_cookie} if self.org_cookie else None,
                    files=files, data=data,
                )
                if r.status_code != 401:
                    break
            body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            if r.is_error:
                raise RuntimeError(body.get("message") or f"HTTP {r.status_code}")
            return body.get("data", {})
