"""Unit tests for blinkit_ads_bids.apply_bids against a fake Blinkit Ads API.
Run: python -m pytest services/browser/test_blinkit_ads_bids.py  (or python this_file)"""
import asyncio
import copy

import blinkit_ads_bids as ab


class FakePage:
    def __init__(self, server):
        self.server = server

    async def evaluate(self, js, args):
        path, method, body, _ = args
        assert path == ab.BULK and method == "PUT"
        return self.server.put(body)


class FakeApi:
    """Mimics AdsApi: call() for the bulk read, page.evaluate() for the PUT."""

    def __init__(self, campaigns, put_status=200, put_json=None, apply_writes=True):
        self.db = copy.deepcopy(campaigns)
        self.headers = {"firebase_user_token": "x"}
        self.calls = 0
        self.puts = []
        self.put_status, self.put_json, self.apply_writes = put_status, put_json, apply_writes
        self.page = FakePage(self)

    async def authenticate(self):
        pass

    async def call(self, path, body=None):
        self.calls += 1
        assert path == ab.BULK
        return {"status": True, "data": [copy.deepcopy(c) for c in self.db if c["campaign_id"] in body["campaign_ids"]]}

    def put(self, body):
        self.puts.append(copy.deepcopy(body))
        if self.put_status == 200 and self.apply_writes:
            for upd in body["campaigns"]:
                camp = next(c for c in self.db if c["campaign_id"] == upd["campaign_id"])
                for k in upd["keywords"]:
                    kw = next(x for x in camp["keywords"] if x["keyword"] == k["keyword"])
                    for b in k["bids"]:
                        next(x for x in kw["bids"] if x["match_type"] == b["match_type"])["cpm"] = b["cpm"]
        return {"status": self.put_status, "json": self.put_json if self.put_json is not None else {"status": True}}


CAMPAIGNS = [
    {"campaign_id": 390227, "campaign_budget": 3000, "keywords": [
        {"keyword": "mamra almonds", "bids": [{"match_type": "EXACT", "cpm": 450, "max_boost": 0.2}, {"match_type": "SMART", "cpm": 300, "max_boost": None}]},
        {"keyword": "kashmiri badam", "bids": [{"match_type": "EXACT", "cpm": 300, "max_boost": None}]},
    ]},
    {"campaign_id": 642712, "campaign_budget": 1400, "keywords": [
        {"keyword": "edamame", "bids": [{"match_type": "EXACT", "cpm": 250, "max_boost": None}]},
    ]},
]


def ch(id, cid, kw, mt, frm, to):
    return {"id": id, "campaign_id": cid, "keyword": kw, "match_type": mt, "from_cpm": frm, "to_cpm": to}


def run(api, changes):
    out = asyncio.run(ab.apply_bids(api, changes))
    return {r["id"]: r for r in out["results"]}


def test_applies_only_changed_bids_and_verifies():
    api = FakeApi(CAMPAIGNS)
    r = run(api, [ch("1", 390227, "Mamra Almonds", "EXACT", 450, 500), ch("2", 642712, "edamame", "EXACT", 250, 200)])
    assert r["1"]["status"] == "applied" and r["1"]["before"] == 450 and r["1"]["after"] == 500
    assert r["2"]["status"] == "applied" and r["2"]["after"] == 200
    assert len(api.puts) == 1  # one PUT for both campaigns
    sent = {c["campaign_id"]: c for c in api.puts[0]["campaigns"]}
    # only the changed match type is sent, keeping the existing max_boost
    assert sent[390227]["keywords"] == [{"keyword": "mamra almonds", "bids": [{"match_type": "EXACT", "cpm": 500, "max_boost": 0.2}]}]


def test_conflict_when_bid_changed_after_approval():
    api = FakeApi(CAMPAIGNS)
    r = run(api, [ch("1", 390227, "kashmiri badam", "EXACT", 250, 400)])
    assert r["1"]["status"] == "conflict" and api.puts == []


def test_already_at_target_is_applied_without_write():
    api = FakeApi(CAMPAIGNS)
    r = run(api, [ch("1", 390227, "kashmiri badam", "EXACT", 200, 300)])
    assert r["1"]["status"] == "applied" and api.puts == []


def test_out_of_range_and_missing_keyword_fail_without_write():
    api = FakeApi(CAMPAIGNS)
    r = run(api, [ch("1", 390227, "mamra almonds", "EXACT", 450, 2500), ch("2", 390227, "walnut", "EXACT", 100, 200),
                  ch("3", 999, "x", "EXACT", 100, 200), ch("4", 642712, "edamame", "SMART", 100, 200)])
    assert [r[i]["status"] for i in "1234"] == ["failed"] * 4
    assert api.puts == []


def test_rejected_write_marks_failed():
    api = FakeApi(CAMPAIGNS, put_status=400, put_json={"status": False, "message": "bid below floor"})
    r = run(api, [ch("1", 642712, "edamame", "EXACT", 250, 60)])
    assert r["1"]["status"] == "failed" and "bid below floor" in r["1"]["error"]


def test_unverified_write_marks_failed():
    api = FakeApi(CAMPAIGNS, apply_writes=False)  # Blinkit says OK but the bid did not change
    r = run(api, [ch("1", 642712, "edamame", "EXACT", 250, 300)])
    assert r["1"]["status"] == "failed" and "still shows ₹250" in r["1"]["error"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("PASS", name)


# ── HTTP 429 handling: wait once, then stop (never hammer through "too many requests") ──
class StatusPage:
    def __init__(self, statuses):
        self.statuses, self.n = list(statuses), 0

    async def evaluate(self, js, args):
        self.n += 1
        return {"status": self.statuses.pop(0) if self.statuses else 200, "json": {"status": True, "data": []}}


def _no_sleep(monkey):
    import blinkit_ads, blinkit_ads_bids
    async def fast(_):
        return None
    monkey.append((blinkit_ads.asyncio, blinkit_ads.asyncio.sleep))
    blinkit_ads.asyncio.sleep = fast
    blinkit_ads_bids.asyncio.sleep = fast


def _restore(monkey):
    for mod, fn in monkey:
        mod.sleep = fn


def test_read_429_twice_stops_with_rate_limited():
    import blinkit_ads
    saved = []
    _no_sleep(saved)
    try:
        api = blinkit_ads.AdsApi(StatusPage([429, 429, 200]))
        api.headers = {"x": "y"}
        try:
            asyncio.run(api.call("/adservice/v1/advertisers"))
            raise AssertionError("expected rate_limited")
        except blinkit_ads.AdsError as e:
            assert e.code == "rate_limited" and api.page.n == 2  # one wait, then stop: no third request
    finally:
        _restore(saved)


def test_read_single_429_recovers():
    import blinkit_ads
    saved = []
    _no_sleep(saved)
    try:
        api = blinkit_ads.AdsApi(StatusPage([429, 200]))
        api.headers = {"x": "y"}
        asyncio.run(api.call("/adservice/v1/advertisers"))
        assert api.page.n == 2
    finally:
        _restore(saved)


def test_bid_write_429_stops_immediately():
    saved = []
    _no_sleep(saved)
    try:
        api = FakeApi(CAMPAIGNS)
        api.page = StatusPage([429])
        try:
            asyncio.run(ab.apply_bids(api, [ch("1", 642712, "edamame", "EXACT", 250, 300)]))
            raise AssertionError("expected rate_limited")
        except ab.AdsError as e:
            assert e.code == "rate_limited" and api.page.n == 1
    finally:
        _restore(saved)


if __name__ == "__main__":
    for name in ("test_read_429_twice_stops_with_rate_limited", "test_read_single_429_recovers", "test_bid_write_429_stops_immediately"):
        globals()[name]()
        print("PASS", name)
