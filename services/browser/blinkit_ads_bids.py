"""Blinkit Ads keyword bid changes (brands.blinkit.com), applied only after approval in QCP.

Uses exactly the calls the portal's own "Edit keyword bids" bulk panel makes, inside the
logged-in page:
  read   POST /adservice/v1/campaigns/bulk  {"campaign_ids": [...]}
         → [{campaign_id, campaign_budget, keywords: [{keyword, bids: [{match_type, cpm, max_boost}]}], …}]
  write  PUT  /adservice/v1/campaigns/bulk  {"campaigns": [{campaign_id, keywords: [{keyword, bids: [...]}]}]}
         (only the changed keywords / match types are sent, like the portal does)

Safety, per change:
  - the CPM must be within BID_MIN..BID_MAX (QCP checks this too);
  - the live bid is re-read first: if it no longer equals the bid the change was approved
    against, nothing is written for it ("conflict"), so a bid edited in the portal meanwhile
    is never overwritten;
  - after the write the campaigns are read again and each bid is verified ("applied" only
    when Blinkit reports the new CPM).
"""
import asyncio
import re

from blinkit_ads import FETCH_JS, THROTTLE_S, AdsApi, AdsError

BID_MIN, BID_MAX = 50, 2000
MAX_CHANGES = 200
BULK = "/adservice/v1/campaigns/bulk"

WRITE_JS = """async ([path, method, body, headers]) => {
  const r = await fetch(path, { method, credentials: "include",
    headers: { ...headers, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch (e) {}
  return { status: r.status, json };
}"""


def norm(s) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip().lower()


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


async def read_campaigns(api: AdsApi, campaign_ids: list[int]) -> dict[int, dict]:
    res = await api.call(BULK, {"campaign_ids": campaign_ids})
    rows = res if isinstance(res, list) else (res.get("data") if isinstance(res, dict) else None)
    if isinstance(res, dict) and res.get("status") is False:
        raise AdsError("api_error", f"Blinkit Ads could not read campaigns: {str(res.get('message'))[:200]}")
    return {int(c["campaign_id"]): c for c in (rows or []) if isinstance(c, dict) and c.get("campaign_id") is not None}


def find_bid(campaign: dict | None, keyword: str, match_type: str):
    for k in (campaign or {}).get("keywords") or []:
        if norm(k.get("keyword")) == norm(keyword):
            for b in k.get("bids") or []:
                if str(b.get("match_type") or "").upper() == match_type:
                    return k, b
            return k, None
    return None, None


async def write(api: AdsApi, campaigns: list[dict]) -> None:
    """One PUT for every campaign. Setting a bid is idempotent, so a retry after a network
    error or 5xx cannot double-apply anything."""
    if not api.headers:
        await api.authenticate()
    body, last = {"campaigns": campaigns}, "no response"
    for attempt in range(3):
        await asyncio.sleep(THROTTLE_S)
        api.calls += 1
        try:
            r = await api.page.evaluate(WRITE_JS, [BULK, "PUT", body, api.headers])
        except Exception as e:
            last = str(e).splitlines()[0][:120]
            await asyncio.sleep(3 * (attempt + 1))
            continue
        status, js = r["status"], r["json"]
        if status in (401, 403):
            if attempt:
                raise AdsError("login_required", "Blinkit Ads session expired; reconnect")
            await api.authenticate()
            continue
        if status == 429:
            raise AdsError("rate_limited", "Blinkit said too many requests (HTTP 429) on the bid update; stopped")
        if status >= 500:
            last = f"HTTP {status}"
            await asyncio.sleep(5 * 2 ** attempt)
            continue
        if status >= 400 or (isinstance(js, dict) and (js.get("status") is False or js.get("success") is False)):
            msg = js.get("message") if isinstance(js, dict) else None
            raise AdsError("api_error", f"Blinkit Ads rejected the bid update (HTTP {status}): {str(msg)[:200]}")
        return
    raise AdsError("api_error", f"Blinkit Ads bid update kept failing ({last})")


async def apply_bids(api: AdsApi, changes: list[dict]) -> dict:
    """changes: [{id, campaign_id, keyword, match_type, from_cpm, to_cpm}] → per-change results:
    applied | conflict | failed, with the bid Blinkit reports before and after."""
    changes = changes[:MAX_CHANGES]
    results: dict[str, dict] = {}
    ids = sorted({int(c["campaign_id"]) for c in changes})
    before = await read_campaigns(api, ids)

    plan: dict[int, dict[str, list[dict]]] = {}  # campaign → keyword → bids to send
    for c in changes:
        cid, mt, to = int(c["campaign_id"]), str(c["match_type"]).upper(), num(c["to_cpm"])
        kw, bid = find_bid(before.get(cid), c["keyword"], mt)
        current = num(bid.get("cpm")) if bid else None
        res = {"id": str(c["id"]), "before": current}
        if to is None or not BID_MIN <= to <= BID_MAX:
            res.update(status="failed", error=f"New CPM must be between ₹{BID_MIN} and ₹{BID_MAX}")
        elif cid not in before:
            res.update(status="failed", error="Campaign not found in Blinkit Ads")
        elif not bid:
            res.update(status="failed", error=f"Keyword '{c['keyword']}' ({mt}) is no longer in this campaign")
        elif current is not None and abs(current - to) < 0.5:
            res.update(status="applied", after=current, note="already at this bid")
        elif num(c.get("from_cpm")) is not None and current is not None and abs(current - num(c["from_cpm"])) >= 0.5:
            res.update(status="conflict", error=f"Bid changed in Blinkit to ₹{current:g} after approval (expected ₹{num(c['from_cpm']):g}); not changed")
        else:
            res["status"] = "pending"
            out = plan.setdefault(cid, {}).setdefault(kw["keyword"], [])
            if not any(b["match_type"] == mt for b in out):
                out.append({"match_type": mt, "cpm": int(to) if float(to).is_integer() else to, "max_boost": bid.get("max_boost")})
        results[res["id"]] = res

    if plan:
        payload = [{"campaign_id": cid, "keywords": [{"keyword": k, "bids": b} for k, b in kws.items()]} for cid, kws in plan.items()]
        try:
            await write(api, payload)
        except AdsError as e:
            if e.code in ("login_required", "rate_limited", "blocked"):
                raise
            for r in results.values():
                if r["status"] == "pending":
                    r.update(status="failed", error=str(e))
            return {"results": list(results.values()), "apiCalls": api.calls}
        await asyncio.sleep(2)
        after = await read_campaigns(api, sorted(plan))
        for c in changes:
            r = results[str(c["id"])]
            if r["status"] != "pending":
                continue
            _, bid = find_bid(after.get(int(c["campaign_id"])), c["keyword"], str(c["match_type"]).upper())
            now = num(bid.get("cpm")) if bid else None
            r["after"] = now
            if now is not None and abs(now - num(c["to_cpm"])) < 0.5:
                r["status"] = "applied"
            else:
                r.update(status="failed", error=f"Blinkit still shows ₹{now:g} after the update" if now is not None else "Could not verify the new bid")
    return {"results": list(results.values()), "apiCalls": api.calls}
