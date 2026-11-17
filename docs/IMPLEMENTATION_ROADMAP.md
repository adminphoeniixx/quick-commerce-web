# Implementation roadmap: collection reliability

Starting point: `EXISTING_SYSTEM_AUDIT.md` and `BUG_ANALYSIS.md`. The order is by risk.

The architecture stays as it is. The connectors need a real logged-in browser session, and that rules out a Scrapy/HTTPX rewrite: Seller Hub and Ads tokens come from the page. A Scrapy/HTTPX rewrite would add risk without fixing any listed problem.

| Phase | Work | Bugs | Done when |
|---|---|---|---|
| **2a. Decisions (owner)** | Decide B-01 (keep the blinkit.com search on, or put it behind written authorization). Decide hosting (stay in DE or test an India region) | B-01, B-04 | The decisions are recorded here |
| **2b. Deploy fixes** | Build and deploy the current code. Mount the `/data/profiles` + `/app/.import-staging` volumes in Easypanel. Reconnect Blinkit + Blinkit Ads once | B-02, B-03 | A redeploy keeps both logins. A seller sync and an Ads sync succeed on live |
| **3. Network** | (Optional) a 1-hour India-region VM test: open seller.blinkit.com, brands.blinkit.com and one blinkit.com page with the same browser image, and record the results. Migrate only if it is clearly better | B-04 | A written result for each site |
| **4. Error taxonomy** | Classify network, HTTP, WAF and parse errors. Store the category, status and duration on `ChannelReport`. Add an admin diagnostics endpoint: outbound IP + country, DNS/TLS/HTTP reachability of each Blinkit host (one request each, honouring pauses), DB, Redis, browser service | B-07 | Unit tests per category. The diagnostics endpoint works locally |
| **5. Job reliability** | A stale SyncJob sweep. Per-step checkpointing so an interrupted sync resumes without refetching finished steps | B-05, B-06 | Kill-and-resume test passes |
| **6. Data quality** | Shape checks + fixture tests for the search, Seller Hub and Ads parsers. A collector reporting rows that parses to 0 counts as `parse_error` | B-09 | Fixture tests pass. A broken fixture fails loudly |
| **7. Monitoring** | `/api/health/ready`, an admin collection-health view, e-mail alerts on a pause or 3 consecutive failures | B-08 | A simulated pause sends one alert |
| **8. Recovery** | A scheduled `pg_dump` off-host (procedure already in `OPERATIONS.md`), plus a tested restore into a scratch DB | — | Restore drill documented with its date |
| **9. Validation** | Full test run + a short live check (one seller sync, one Ads sync, one small bid change confirmed in the Blinkit portal) | — | Test report |

## Questions for Blinkit (via the seller and Ads account managers)

1. Is there an official API or scheduled report export for seller sales, inventory and listing data, and for Blinkit Ads (campaigns, keywords, bids)?
2. May we automate our own account's Seller Hub and Ads portal from our server? Is there a preferred method or rate?
3. Can our server's static IP be allowlisted for that access?
4. Is written consent possible for monitoring our own products' search positions on blinkit.com? Or is there an official share-of-search report (the Ads portal shows keyword SOV)?
5. Are there request frequency limits we should follow?

## Explicitly out of scope

None of the following will be built:

- Proxy or IP rotation, residential proxies, or Webshare **for getting past a Blinkit block**.
- Stealth browser patches, fingerprint spoofing, or captcha solving.
- Floating IPs. They give no benefit on a single node.
