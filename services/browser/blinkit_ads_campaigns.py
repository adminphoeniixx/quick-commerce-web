"""Verified Blinkit Ads campaign mutations using Brand Central's own JSON calls.

Every mutation re-reads the live campaign first and verifies the result afterwards.
Blinkit's DELETE endpoint stops a campaign; it does not permanently erase history.
"""
import asyncio
from datetime import date, datetime, timedelta, timezone

from blinkit_ads import AdsApi, AdsError, THROTTLE_S
from blinkit_ads_bids import WRITE_JS, num

V1 = "/adservice/v1/campaigns"
V3 = "/adservice/v3/campaigns"
IST = timezone(timedelta(hours=5, minutes=30))


def _date(value) -> str:
    if not value:
        return ""
    if isinstance(value, (date, datetime)):
        d = value
    else:
        d = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if isinstance(d, datetime) and d.tzinfo is not None:
        d = d.astimezone(IST)
    return f"{d.month}/{d.day}/{d.year}"


def _csv(value) -> str:
    if isinstance(value, list):
        return ",".join(str(x) for x in value if x is not None and str(x))
    return "" if value is None else str(value)


async def detail(api: AdsApi, campaign_id: int) -> dict:
    out = await api.call(f"{V1}/{campaign_id}")
    data = out.get("data") if isinstance(out, dict) else None
    campaign = data.get("campaign") if isinstance(data, dict) else None
    if not isinstance(campaign, dict):
        raise AdsError("api_error", f"Campaign {campaign_id} was not found in Blinkit Ads")
    return campaign


async def with_advertiser(api: AdsApi, campaign: dict) -> dict:
    """Campaign detail omits advertiser identity, but V3 writes require it."""
    out = await api.call("/adservice/v1/advertisers")
    items = out.get("items") if isinstance(out, dict) else None
    advertiser = items[0] if isinstance(items, list) and items else None
    if not isinstance(advertiser, dict) or not advertiser.get("id"):
        raise AdsError("api_error", "Blinkit Ads advertiser account was not found")
    return {**campaign, "advertiser_id": advertiser["id"], "brand_name": advertiser.get("name") or ""}


def payload(c: dict, request_type: str, *, name=None, budget=None, start=None, end=None, no_end=None) -> dict:
    products = [{"id": p.get("id"), "order": p.get("order"), "is_star_product": bool(p.get("is_star_product"))}
                for p in (c.get("products") or []) if p.get("id") is not None]
    infinite = bool(c.get("infinite_campaign")) if no_end is None else bool(no_end)
    end_value = "12/31/9999" if infinite else _date(end if end is not None else c.get("end_ts"))
    start_value = _date(start if start is not None else c.get("start_ts"))
    region_ids = _csv(c.get("region_ids"))
    if "PAN" in str(c.get("region_type") or "").upper() or not region_ids:
        region_ids = "-1"
    campaign_type = str(c.get("campaign_type") or "")
    data = {
        "brand_ids": _csv(c.get("brand_ids")),
        "category_ids": _csv(c.get("category_ids")),
        "pids": _csv(c.get("pids")),
        "products": products,
        "ro_details": c.get("ro_details") or {"ro_number": None, "ro_amount": None, "ro_issue_date": None, "proof_url": None},
    }
    if campaign_type == "BANNER_LISTING":
        creative = c.get("creative_components") or {}
        data.update({
            "highlighted_pids": _csv(c.get("highlighted_pids")),
            "creative_type": c.get("creative_type") or "",
            "brand_page_id": c.get("brand_page_id"),
            "image_url": c.get("mobile_image_url") or "",
        })
        if creative.get("creative_id") is not None:
            data["creative_id"] = creative["creative_id"]
    out = {
        "source_platform": "diy_dashboard_web",
        "requested_by": c.get("requested_by") or "",
        "advertiser_id": int(c.get("advertiser_id") or 0),
        "brand_name": c.get("brand_name") or "",
        "campaign_id": int(c.get("id") or 0),
        "objective_type": c.get("objective_type") or "",
        "asset_type": campaign_type,
        "image_url": c.get("mobile_image_url") or "",
        "header_title": c.get("header_title") or "",
        "creative_type": c.get("creative_type") or "",
        "highlighted_pids": _csv(c.get("highlighted_pids")),
        "collection_id": c.get("collection_id") or (str(c.get("brand_page_id")) if campaign_type == "BANNER_LISTING" and c.get("brand_page_id") else ""),
        "store_name": c.get("store_name") or "",
        "name": str(name if name is not None else c.get("name") or ""),
        "campaign_start": start_value,
        "campaign_end": end_value,
        "cpm": num(c.get("cpm")) or 0,
        "campaign_data": data,
        "bidding_strategy": {
            "total_budget": num(budget if budget is not None else c.get("campaign_budget")) or 0,
            "pacing_type": c.get("pacing_type") or "DAILY",
        },
        "campaign_targeting": {
            "city_ids": region_ids,
            "is_extendable": False,
            "keyword_targeting": {"keywords": c.get("keywords") or []},
        },
        "campaign_request_type": request_type,
        "preview_image_url": c.get("preview_image_url") or "",
    }
    return out


async def _write(api: AdsApi, path: str, method: str, body: dict | None = None) -> dict:
    if not api.headers:
        await api.authenticate()
    await asyncio.sleep(THROTTLE_S)
    result = await api.page.evaluate(WRITE_JS, [path, method, body or {}, api.headers])
    status, js = result["status"], result.get("json")
    if status in (401, 403):
        raise AdsError("login_required", "Blinkit Ads session expired; reconnect")
    if status == 429:
        raise AdsError("rate_limited", "Blinkit rate-limited the campaign change; stopped to protect the account")
    if status >= 400 or (isinstance(js, dict) and (js.get("success") is False or js.get("status") is False)):
        msg = js.get("message") if isinstance(js, dict) else None
        raise AdsError("api_error", f"Blinkit Ads rejected the campaign change (HTTP {status}): {str(msg)[:200]}")
    return js if isinstance(js, dict) else {}


def _check_before(c: dict, change: dict) -> None:
    expected_status = change.get("expected_status")
    if expected_status and str(c.get("status")) != expected_status:
        raise AdsError("conflict", f"Campaign status changed to {c.get('status')} (expected {expected_status}); refresh and retry")
    expected_budget = num(change.get("expected_budget"))
    current = num(c.get("campaign_budget"))
    if expected_budget is not None and current is not None and abs(expected_budget - current) >= 0.01:
        raise AdsError("conflict", f"Campaign budget changed to {current:g} (expected {expected_budget:g}); refresh and retry")


async def apply_campaign_action(api: AdsApi, change: dict) -> dict:
    action, campaign_id = str(change["action"]), int(change["campaign_id"])
    before = await detail(api, campaign_id)
    _check_before(before, change)
    before_view = {"status": before.get("status"), "budget": num(before.get("campaign_budget")), "name": before.get("name")}

    if action == "stop":
        if before.get("status") == "STOPPED":
            return {"action": action, "campaignId": str(campaign_id), "before": before_view, "after": before_view, "note": "already stopped"}
        await _write(api, f"{V1}/{campaign_id}", "DELETE")
        result_id = campaign_id
    elif action in ("update", "restart", "duplicate"):
        if action == "restart" and "RESTART" not in (before.get("allowed_transitions") or []):
            raise AdsError("conflict", "Blinkit does not currently allow this campaign to restart")
        request_type = {"update": "UPDATE", "restart": "RESTART", "duplicate": "CREATE"}[action]
        writable = await with_advertiser(api, before)
        body = payload(
            writable, request_type,
            name=change.get("name"), budget=change.get("budget"), start=change.get("start"),
            end=change.get("end"), no_end=change.get("no_end"),
        )
        if action == "restart":
            body["campaign_start"] = _date(change.get("start") or date.today())
        if action == "duplicate":
            body["campaign_id"] = 0
        response = await _write(api, V3, "POST" if action == "duplicate" else "PUT", body)
        result_id = int((response.get("data") or {}).get("campaign_id") or 0)
        if result_id <= 0:
            raise AdsError("api_error", "Blinkit did not return a valid campaign id")
    else:
        raise AdsError("api_error", f"Unsupported campaign action: {action}")

    await asyncio.sleep(2)
    after = await detail(api, result_id)
    after_view = {"status": after.get("status"), "budget": num(after.get("campaign_budget")), "name": after.get("name")}
    if action == "stop" and after.get("status") != "STOPPED":
        raise AdsError("api_error", f"Blinkit still reports status {after.get('status')} after stop")
    if action in ("update", "restart") and change.get("budget") is not None:
        if abs((num(after.get("campaign_budget")) or 0) - float(change["budget"])) >= 0.01:
            raise AdsError("api_error", "Blinkit did not persist the requested campaign budget")
    if action == "duplicate" and result_id == campaign_id:
        raise AdsError("api_error", "Blinkit returned the source campaign id instead of creating a duplicate")
    return {"action": action, "campaignId": str(result_id), "sourceCampaignId": str(campaign_id), "before": before_view, "after": after_view}
