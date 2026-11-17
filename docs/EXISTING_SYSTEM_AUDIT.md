# Existing system audit: Blinkit data collection

Audit date: 2026-11-14. This audit covers the collection side of Quick Commerce Pulse (QCP): the connectors, the browser service, jobs, storage and networking. Facts come from the code and from runs on the local stack and the live server. Anything that was not verified says so.

## 1. What the project contains

| Layer | Implementation | Where |
|---|---|---|
| Web app + API | Next.js 16 (TypeScript), RBAC, audit log, CSRF, rate limits | `app/`, `lib/` |
| Database | PostgreSQL via Prisma, 16 migrations | `prisma/` |
| Jobs | BullMQ on Redis: import, aggregation and scheduled/one-off syncs | `lib/queue/`, `worker/index.ts` |
| Browser connector | Python FastAPI + Playwright. It keeps one persistent Chrome profile per connection, offers a remote login window, and runs syncs as background jobs | `services/browser/` |
| File imports | CSV/XLSX adapters (products, sales, availability, pricing, visibility). Imports are staged, validated, and dead-lettered on final failure | `lib/ingest/` |
| Local agent | An MCP server on the user's own Chrome (CDP), plus a LangGraph runner | `agent/` |
| Packaging | `docker-compose.production.yml` (web, worker, browser, postgres, redis) for local use. `Dockerfile.allinone` (web + worker + browser in one container) for Easypanel | repo root |

### Connectors (sources)

| Connector | Source | Access | Data | Code |
|---|---|---|---|---|
| Blinkit Seller | seller.blinkit.com | Seller's own login (OTP) in a saved profile | Sales reports, catalog, inventory, listing SEO (Seller Hub JSON) | `platforms.py:Blinkit`, `blinkit_seller_seo.py` |
| Blinkit Ads | brands.blinkit.com | Seller's own login (email magic link) | Account, campaigns, daily metrics, keyword reports; **bid changes (writes)** | `blinkit_ads.py`, `blinkit_ads_bids.py` |
| blinkit.com search SEO | blinkit.com (consumer site, public) | No login | Search result positions, ratings and prices for the brand's ad keywords | `blinkit_search.py` |
| Zepto / Instamart / BigBasket | — | — | Adapters fail closed: no written authorization | `lib/marketplace/` |

### Existing reliability features

- **Job records.** `SyncJob` and `ChannelReport` are persistent. Every downloaded file is stored as `ChannelReport.fileData`, which gives raw provenance. `ImportJob` keeps retry and dead-letter state. `AdBidChange` is a state machine.
- **Retries.**
  - BullMQ retries with exponential backoff.
  - Seller report builds get one delayed retry.
  - Ads and Seller Hub API calls back off on 5xx.
  - A 429 is waited out once, then the run stops.
- **Block protection** (`lib/connections/guard.ts`):
  - A block page, captcha or 429 pauses that connection for 24 h.
  - Only one Blinkit browser session runs at a time.
  - Scheduled syncs run at least 6 h apart.
  - blinkit.com search: at most 2 runs per city and 6 in total per IST day.
  - Bids: at most 150 changes a day and 3 per keyword a day.
- **Idempotent writes.** Upserts run on unique keys, for example `AdKeywordDaily(brandId, platformId, campaignId, date, dimension, dimKey)`, `ListingSeoSnapshot(... date, productId)` and `SearchListingObservation(... snapshotDate, keyword, city, productId)`.
- **Health check.** `/api/health/live` serves as the Docker healthcheck. Logs are structured JSON (`lib/logger.ts`).
- **Backup and restore.** The `pg_dump`/`pg_restore` procedure is in `docs/OPERATIONS.md`.

## 2. What works (verified)

| Item | Evidence |
|---|---|
| Seller and Ads syncs from the live server | Ads sync succeeded on live on 2026-11-05/06. The live Blinkit seller connection synced on 2026-11-06 |
| Listing SEO, from the local stack and the laptop MCP | 17 products, about 68 calls per run |
| blinkit.com search from a home (Indian residential) connection | Local runs for Bengaluru, Mumbai and Gurugram on 2026-11-13: 10 keywords × 36 results each. Imported to live |
| Bid change flow | Browser E2E against a fake Blinkit HTTP layer: 20 checks, plus 9 Python unit tests |
| Block protection | Pause, skip and limit behaviour tested on 2026-11-13 |
| Type check / unit tests | `tsc` clean. vitest: 60 passed, 26 skipped (the skipped ones need a test DB) |

## 3. What is broken or partial

Details are in `BUG_ANALYSIS.md`.

1. **blinkit.com search from the live server gets a block page.** This is a source and IP problem, not a code problem (see §4).
2. **The live server loses its Blinkit logins on redeploy.** After the 2026-11-13 redeploy the seller profile was gone ("not connected yet"). `/data/profiles` is probably not a persistent Easypanel volume. Not yet verified in the Easypanel UI.
3. **Live was running images that lacked `blinkit_search.py` / `blinkit_seller_seo.py`.** Every Blinkit sync failed. This is fixed in code (`Dockerfile.allinone` copies `*.py` and runs an import check) but was not yet built and deployed at the time of this audit.
4. **Browser-service jobs live in memory.** A restart mid-sync loses the job, and the next run starts from scratch.
5. **A `SyncJob` can stay `RUNNING` forever** if the worker process dies mid-run. Nothing sweeps stale sync jobs.
6. **Error categories are coarse.** The codes are `login_required`, `blocked`, `captcha`, `rate_limited`, `api_error` and `internal`. Network failures (DNS, TLS, timeout, connection reset) all collapse into `internal` or `api_error`.
7. **No metrics or alerting.** There is no Prometheus endpoint and no alert on failed syncs, pauses or dead-lettered imports.
8. **Connector parsers have no tests.** This covers `parse_search_products`, the Seller Hub collectors and the Ads collectors.
9. **Compliance conflict.** The repo's own `docs/scraping/PLATFORM_FEASIBILITY_MATRIX.md` records that Blinkit's terms prohibit data-mining or robot tools on product listings and prices without express prior written consent. The blinkit.com search connector collects exactly that data. See `BUG_ANALYSIS.md` B-01.

## 4. Network assessment

| Fact | Value | How checked |
|---|---|---|
| Live server public IP | 75.119.149.45 | DNS of the Easypanel host |
| ASN / provider | AS51167, Contabo GmbH | Team Cymru whois |
| IP country | **Germany (DE)** | Team Cymru whois |
| IPv6 | not checked | — |
| blinkit.com from live | Block page (Cloudflare) | Panel sync on 2026-11-13 |
| seller.blinkit.com and brands.blinkit.com from live | Worked on 2026-11-05/06 | Sync history |
| blinkit.com from an Indian home connection | Works | 4 runs on 2026-11-13 |
| blinkit.com robots.txt | Not published (returns an error page) | Fetched 2026-11-14 |
| blinkit.com terms | Rendered client-side, so not re-read here. The repo's 2026-10-28 review recorded the restriction above | `docs/scraping/PLATFORM_FEASIBILITY_MATRIX.md` |

**Classification of the live failures:**

| Failure | Category |
|---|---|
| Missing modules | Application (deploy) |
| Lost logins | Configuration (volume) |
| blinkit.com block page | Source restriction + IP reputation/geography: a German datacenter IP on an India-only consumer site behind a WAF |

None of the failures is a network connectivity failure: DNS, TLS and HTTP all completed.

### Options

| Option | Fits for | Assessment |
|---|---|---|
| **A. Move the server to an India region** (e.g. AWS ap-south-1 Mumbai, DigitalOcean BLR1, GCP asia-south1/2, Azure Central India) | Seller + Ads portals (the user's own accounts) | **Recommended for hosting.** It removes the geography mismatch, lowers latency to Blinkit, and keeps one stable IP. It is still a datacenter ASN, so the consumer-site WAF may still block it. Test with a short-lived VM before moving. |
| B. Webshare India proxies | — | **Not recommended.** For the consumer site, routing through proxies after a block would be evading the source's restriction, which this project rules out. For the seller and Ads portals, it puts the user's own logged-in accounts behind third-party shared IPs. That raises account-security and flagging risk with no benefit over option A. |
| C. Static IP | Allowlisting | Useful **only if** Blinkit agrees to allowlist it. Most India-region VPS providers give a static IPv4 by default. |
| D. Floating IP | — | **Not justified.** A floating IP is a failover tool. It does not change reputation or acceptance, and QCP runs on a single node. |
| E. Official access | All Blinkit data | **The only route that removes the risk.** Ask Blinkit via the seller and Ads account managers for written authorization, an official reporting/API feed, or IP allowlisting (questions in `IMPLEMENTATION_ROADMAP.md`). |

Blinkit publishes no crawler-allowlisting program. Allowlisting would have to be arranged through the account manager.
