# blinkit.com keyword search from THIS laptop's internet, saved into the LIVE panel.
# The Easypanel server's datacenter IP gets a blinkit.com block page; a home connection does not.
# Usage: ./seo_search_to_live.sh "Sector 50 Gurugram"   (same guardrails: 10 keywords, 2 runs per city per day)
import re, sys, json, time, base64, urllib.request, http.cookiejar
ACCESS, AREA = sys.argv[1], sys.argv[2]
txt = open(ACCESS).read().split("## Local")[0]
rows = {m.group(1).strip(): m.group(2).strip() for m in re.finditer(r"\|[^|]*\|\s*(\S+@\S+)\s*\|\s*([^|]+?)\s*\|", txt)}
LIVE = "https://dabad-demo-quickcommerce.rmsiry.easypanel.host"; SVC = "http://127.0.0.1:8100"; TOK = {"x-service-token": "testtoken"}
cj = http.cookiejar.CookieJar(); op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
def call(url, body=None, headers={}, opener=op):
    csrf = next((c.value for c in cj if "csrf" in c.name.lower()), "")
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers={"content-type": "application/json", "x-csrf-token": csrf, **headers}, method="POST" if body is not None else "GET")
    try:
        with opener.open(r, timeout=120) as f: return f.status, json.loads(f.read())
    except urllib.error.HTTPError as e: return e.code, e.read().decode()[:500]
for i in range(30):
    try: call(SVC + "/health"); break
    except Exception: time.sleep(2)
print("live login", call(LIVE + "/api/auth/login", {"email": "seller@quickcommerce.local", "password": rows["seller@quickcommerce.local"].strip("`")})[0])
s, info = call(LIVE + "/api/seo/sync"); kws = info["data"]["keywords"]; print("keywords", kws)
ALIAS = {"gurugram": ["gurgaon"], "gurgaon": ["gurugram"], "bengaluru": ["bangalore"], "bangalore": ["bengaluru"]}
used = max([n for c, n in info["data"]["runsToday"].items() if any(a in AREA.lower() for a in [c.lower(), *ALIAS.get(c.lower(), [])])] or [0])
d = info["data"]
if d.get("paused") or d.get("searchPaused"):
    sys.exit(d.get("paused") or d.get("searchPaused"))
if d.get("limitTotalPerDay") and (d.get("totalToday") or 0) >= d["limitTotalPerDay"]:
    sys.exit(f"blinkit.com search already ran {d['totalToday']}x today (all cities); limit {d['limitTotalPerDay']} a day. Try tomorrow.")
if used >= info["data"]["limitPerDay"]:
    sys.exit(f"blinkit.com search already ran {used}x today for this city: try tomorrow or another city.")
s, j = call(SVC + "/sync/9001", {"platform": "blinkit", "sales": False, "catalog": False, "inventory": False, "seo": False, "search": {"keywords": kws, "location": AREA}}, TOK); print("job", s, j)
while True:
    s, st = call(SVC + "/sync/9001/status", headers=TOK)
    if st["status"] != "running": print(st["status"], st["activity"]); break
    time.sleep(8)
s, res = call(SVC + "/sync/9001/result", headers=TOK)
rep = res["reports"][0]; print("search step:", rep["status"], rep.get("error"))
if rep["status"] != "ok": sys.exit(1)
payload = json.loads(base64.b64decode(rep["data"]))
print("city", payload["city"], "|", sum(len(r["products"]) for r in payload["results"]), "products across", len(payload["results"]), "keywords")
print("import to live:", call(LIVE + "/api/seo/search/import", {"brandId": "1", "payload": payload}))
