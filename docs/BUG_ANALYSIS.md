# Bug analysis: collection system

Audit date: 2026-11-14. Every item was found by reading the code or observing a run. Severity: **Critical** means data is wrong or lost, or there is account or compliance risk; **High** means a feature fails in production; **Medium** means reduced reliability or visibility; **Low** means cleanup.

| ID | Severity | Status |
|---|---|---|
| B-01 | Critical (compliance) | Open: decision needed |
| B-02 | Critical | Fixed in code, not deployed |
| B-03 | High | Open (deploy configuration) |
| B-04 | High | Open (source / IP) |
| B-05 | Medium | Open |
| B-06 | Medium | Open |
| B-07 | Medium | Open |
| B-08 | Medium | Open |
| B-09 | Medium | Open |
| B-10 | Low | Open |

---

### B-01: blinkit.com search connector conflicts with Blinkit's terms (as recorded in the repo)

**Location**
- File: `services/browser/blinkit_search.py`
- Functions: `search_keywords`, `set_location`, `location_suggestions`
- Callers: `services/browser/platforms.py` (`Blinkit.search_seo`) and `agent/browser_mcp.py` (`blinkit_keyword_rank`)

**Problem.** The connector automates blinkit.com searches and stores product listings, ranks, ratings and prices (`SearchListingObservation`). The repo's own `docs/scraping/PLATFORM_FEASIBILITY_MATRIX.md` (reviewed 2026-10-28) records that Blinkit's terms disallow data-mining or robot tools on product listings, descriptions and prices without express prior written consent. The marketplace adapters in `lib/marketplace/` fail closed for this reason, but this newer connector does not.

**Root cause.** The connector was added later, on request, with rate guardrails but without a consent gate.

**Impact.**
- Terms violation risk for the seller's business relationship with Blinkit.
- Possible block of the IP or account.
- Inconsistent compliance posture within the same repo.

**Recommended fix.**
- Put the connector behind an explicit setting, `BLINKIT_SEARCH_AUTHORIZED`, that **defaults to off**. Both the panel route and the MCP refuse to run without it.
- Record who enabled it and the written consent reference.
- Ask Blinkit for written consent or an official keyword-rank/SOV feed. The Ads portal already exposes `keyword-sov` and `sponsored-sov` endpoints for the advertiser's own account, which may cover most of the need from an authorized source.

**Test method.** A unit test asserts that the route and the MCP refuse while the flag is off.

---

### B-02: Live image missing browser modules

**Location**
- File: `Dockerfile.allinone`
- Instruction: the COPY line for the browser service

**Problem.** It copied only `app.py`, `platforms.py` and `blinkit_ads.py`. Every Blinkit sync on live failed with `No module named 'blinkit_search'` / `'blinkit_seller_seo'` (SyncJob history on live, 2026-11-06 and 2026-11-13).

**Root cause.** New modules were added only to `services/browser/Dockerfile`. They are imported lazily, so start-up never failed.

**Impact.** All live seller syncs failed.

**Fix (done).**
- `COPY services/browser/*.py`.
- A build-time import check: `RUN python -c "import platforms, blinkit_ads, blinkit_ads_bids, blinkit_search, blinkit_seller_seo"`.
- The same change in `services/browser/Dockerfile`.

**Test.** The image build fails if any module is missing. Verified by building `Dockerfile.allinone` locally on 2026-11-13.

---

### B-03: Live server loses Blinkit logins on every redeploy

**Location**
- Deployment config (Easypanel)
- Code path: `PROFILE_DIR=/data/profiles` (`Dockerfile.allinone`, `services/browser/app.py:open_context`)

**Problem.** After the 2026-11-13 redeploy, the browser service answered `login_required: not connected yet`, meaning the profile directory was missing (SyncJob #8 on live).

**Root cause (probable).** `/data/profiles` is not mounted as a persistent volume in Easypanel, so the container filesystem resets on each deploy. This has not been verified in the Easypanel UI.

**Impact.**
- Every deploy logs out seller and Ads. Syncs and bid applies fail until the seller reconnects (OTP or magic link).
- Repeated fresh logins from a datacenter IP also look more suspicious to Blinkit.

**Fix.** Mount `/data/profiles` (and `/app/.import-staging`) as volumes, as `README.md` §5 already specifies.

**Test.** Reconnect, redeploy, then confirm the connection still syncs without a new login.

---

### B-04: blinkit.com blocks the live server

**Location**
- Network: live host 75.119.149.45, AS51167 Contabo, **Germany**
- Code: `services/browser/blinkit_search.py:_check`

**Problem.** The live search step ends with "blinkit.com is showing a block page" within about 3 s. The same code from an Indian residential connection works.

**Root cause.** blinkit.com's WAF refuses this traffic. A foreign datacenter IP on an India-only consumer service is the most likely trigger. It is not an application bug: DNS, TLS and HTTP all succeed, and the page is a block page.

**Impact.** "Sync SEO now" (search) cannot work from live.

**Fix.**
- Do not route around the block.
- See B-01 (authorization) and the network options in `EXISTING_SYSTEM_AUDIT.md` §4. Hosting in an India region is worth testing for the seller and Ads portals. For blinkit.com, authorization is the real fix.

**Test.** Run a one-page check from a candidate India-region VM before migrating.

---

### B-05: Browser-service jobs live only in memory

**Location**
- File: `services/browser/app.py`
- Data and functions: `state["jobs"]`, `run_sync_job`, `start_sync`

**Problem.** If the browser service restarts during a sync, the job and its downloaded step data are lost. QCP's `fetchReports` (`lib/connections/browser.ts`) then throws "Sync job disappeared" and the whole sync must re-run. A full Ads sync is about 650 calls and 15 min.

**Root cause.** Jobs were designed as in-memory, poll-based work.

**Impact.**
- Wasted time.
- Repeated Blinkit calls after a crash, which raises block risk.

**Recommended fix.**
- Have the browser service return each finished step to QCP as soon as it completes (stream or poll per step). QCP stores it as a `ChannelReport` immediately.
- On re-run, skip steps already stored today, using a checkpoint in `SyncJob.meta`.

**Test.** Kill the browser container mid-sync, re-run, and assert that the completed steps are not fetched again.

---

### B-06: Stale `SyncJob` rows stay `RUNNING`

**Location**
- File: `lib/connections/sync.ts`
- Function: `runBrowserSync`
- Related: `worker/index.ts`

**Problem.** If the worker process dies mid-sync, the `finally`/`catch` never runs and the SyncJob stays `RUNNING`. The progress API (`app/api/connections/[id]/sync/progress`) then shows a sync that never ends. The 6-hour scheduled-sync gap also counts it.

**Root cause.** Unlike `AdBidChange` (`expireStale` in `lib/ads/bids.ts`), sync jobs have no stale sweep.

**Fix.** On worker start, and on each progress read, mark `RUNNING` jobs older than 60 min as `FAILED` ("interrupted").

**Test.** Insert a RUNNING row 2 h old, start the worker, and assert FAILED.

---

### B-07: Network and HTTP errors are not classified

**Location**
- Files: `services/browser/blinkit_ads.py` (`AdsApi.call`), `blinkit_seller_seo.py` (`SellerApi.call`), `blinkit_search.py`, `app.py` (`run_sync_job`)

**Problem.** DNS failures, TLS errors, timeouts and connection resets surface as `internal` or `api_error` with free text. HTTP 403 is only recognised as a block when the page text says so.

**Impact.**
- The cause of a failure cannot be diagnosed (network, source or IP).
- Retry decisions are coarse.

**Fix.**
- Add an error taxonomy: `network_dns`, `network_tls`, `network_timeout`, `network_reset`, `http_403`, `http_429`, `http_5xx`, `waf_block`, `captcha`, `login_required`, `parse_error`.
- Record the category, HTTP status, duration and step on `ChannelReport`. Keep tokens and cookies out of it.

**Test.** Unit tests feed each failure type and assert the category.

---

### B-08: No metrics or alerts

**Location**
- `lib/logger.ts`, `/api/health/live`

**Problem.** There is no metrics endpoint and no alert on failed syncs, connection pauses, dead-lettered imports or failed bid applies.

**Impact.** Problems are only seen when someone opens the panel.

**Fix.**
- Add an `/api/health/ready` covering DB, Redis and the browser service.
- Add an admin "collection health" endpoint: per connection, the last success, pause state, failures in the last 24 h and error categories.
- Add an e-mail alert via the existing `lib/mailer.ts` when a connection pauses or fails 3 times in a row.

**Test.** Simulate a pause and assert that one alert is sent.

---

### B-09: Connector parsers have no tests

**Location**
- `blinkit_search.py:parse_search_products`
- `blinkit_seller_seo.py:collect_listing_seo`
- `blinkit_ads.py` collectors
- `lib/ads/ingest.ts`

**Problem.** Blinkit changes its JSON or HTML shapes without notice. A silent shape change would store empty or wrong rows with no failure.

**Fix.**
- Fixture-based tests using saved responses from `agent/downloads/*.json`, with personal data removed.
- A "shape check" in each collector: required fields present, row count above 0 when the source reported rows. A failed check makes the step fail with `parse_error`.

**Test.** Remove a key from a fixture and assert `parse_error`.

---

### B-10: Leftover artifacts

**Location**
- `node_modules.interrupted-20261028-1055/`, `playwright-report/`, `test-results/`, `tsconfig.tsbuildinfo` in the repo root.

**Fix.** Delete them, or add them to `.gitignore` / `.dockerignore`. They are not in the Docker build context for `node_modules*`, but `playwright-report` and `test-results` are.
