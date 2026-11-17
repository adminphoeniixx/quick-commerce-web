import asyncio
import copy

import blinkit_ads_campaigns as campaigns


BASE = {"id": 12, "name": "Original", "status": "STOPPED", "allowed_transitions": ["RESTART"],
        "campaign_type": "PRODUCT_LISTING", "campaign_budget": 1000, "pacing_type": "DAILY",
        "start_ts": "2026-10-01T00:00:00Z", "end_ts": None, "infinite_campaign": True,
        "products": [{"id": 7}], "pids": [7], "region_type": "PAN_INDIA", "keywords": []}


class FakeApi:
    def __init__(self):
        self.campaign = copy.deepcopy(BASE)

    async def call(self, path, body=None):
        if path.endswith("/advertisers"):
            return {"items": [{"id": 99, "name": "Test Brand"}]}
        return {"data": {"campaign": copy.deepcopy(self.campaign)}}


def test_payload_preserves_targeting_and_products():
    p = campaigns.payload(BASE, "RESTART", budget=1500, start="2026-11-17", no_end=True)
    assert p["campaign_request_type"] == "RESTART"
    assert p["bidding_strategy"]["total_budget"] == 1500
    assert p["campaign_targeting"]["city_ids"] == "-1"
    assert p["campaign_data"]["products"][0]["id"] == 7
    assert p["campaign_end"] == "12/31/9999"


def test_update_preserves_start_date_in_portal_ist():
    p = campaigns.payload(BASE, "UPDATE", budget=1000)
    assert p["campaign_start"] == "10/1/2026"
    shifted = {**BASE, "start_ts": "2025-12-25 18:30:00+00:00"}
    assert campaigns.payload(shifted, "UPDATE")["campaign_start"] == "12/26/2025"


def test_optimistic_conflict():
    try:
        campaigns._check_before(BASE, {"expected_status": "ACTIVE"})
    except campaigns.AdsError as e:
        assert e.code == "conflict"
    else:
        raise AssertionError("expected conflict")


def test_advertiser_is_hydrated_for_writes():
    out = asyncio.run(campaigns.with_advertiser(FakeApi(), BASE))
    assert out["advertiser_id"] == 99
    assert out["brand_name"] == "Test Brand"


def test_update_is_written_and_verified(monkeypatch):
    api = FakeApi()
    api.campaign["status"] = "ACTIVE"
    api.campaign["allowed_transitions"] = ["UPDATE"]

    async def fast_sleep(_):
        return None

    async def fake_write(_api, path, method, body=None):
        assert path == campaigns.V3 and method == "PUT"
        assert body["advertiser_id"] == 99
        _api.campaign["campaign_budget"] = body["bidding_strategy"]["total_budget"]
        _api.campaign["name"] = body["name"]
        return {"data": {"campaign_id": 12}}

    monkeypatch.setattr(campaigns.asyncio, "sleep", fast_sleep)
    monkeypatch.setattr(campaigns, "_write", fake_write)
    out = asyncio.run(campaigns.apply_campaign_action(api, {
        "action": "update", "campaign_id": 12, "expected_status": "ACTIVE",
        "expected_budget": 1000, "budget": 1250, "name": "Updated",
    }))
    assert out["after"] == {"status": "ACTIVE", "budget": 1250.0, "name": "Updated"}
