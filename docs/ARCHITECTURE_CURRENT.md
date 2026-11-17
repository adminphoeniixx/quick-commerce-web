# Current architecture: collection side

As of 2026-11-14. The rest of the app (dashboards, RBAC, imports UI) is described in `ARCHITECTURE.md`.

```
                     ┌──────────────────────── Easypanel (Contabo, DE, 75.119.149.45) ─────────────────────────┐
 Seller (browser) ──▶│  Next.js web (app/, lib/)          BullMQ worker (worker/)          Browser service        │
                     │   · panel + API + RBAC     ──Redis──▶ · connection-sync jobs  ──HTTP──▶ (services/browser) │
                     │   · /api/seo/sync, /api/ads/bids     · ads-bids jobs                 FastAPI + Playwright │
                     │   · import pipeline                  · scheduled syncs                one Chrome profile │
                     │                │                              │                       per connection    │
                     │                └────────── PostgreSQL (Prisma) ◀──────────────────────────┘             │
                     └───────────────────────────────────────────────────────────────┬────────────────────────┘
                                                                                     │ Chrome (Xvfb, headful)
                                       seller.blinkit.com ◀── own seller login ──────┤
                                       brands.blinkit.com ◀── own Ads login ─────────┤  (reads + approved bid writes)
                                       blinkit.com        ◀── public search ─────────┘  (blocked from this IP)

 Laptop (India, residential):  agent/start_chrome.sh → Chrome (CDP 127.0.0.1:9222) ◀── agent/browser_mcp.py (MCP)
                               └─ same Python modules (services/browser/*.py) → imports into live via QCP API
```

## Flow of a sync

1. The panel or schedule calls `runBrowserSync(connectionId, trigger, opts)` in `lib/connections/sync.ts`. It checks the connection status, the block pause (`guard.ts`) and the 6-hour scheduled gap, then creates a `SyncJob`.
2. `fetchReports` (`lib/connections/browser.ts`) sends POST `/sync/{id}` to the browser service, then polls `/status` and finally reads `/result`.
3. The browser service takes the global Blinkit lock and opens the connection's persistent profile. `Platform.plan_sync` returns the steps: sales ranges, catalog, inventory, listing SEO, search SEO, Ads collectors, or bids. Each step runs inside the logged-in page with the page's own session headers.
4. Results come back as base64 files. `importReports` stores each one as a `ChannelReport` (raw provenance) and ingests it. Ingest is an upsert on natural keys.
5. A failure code drives connection state: `login_required` sets the connection to `ERROR`/reconnect; `blocked`, `captcha` or `rate_limited` pause it for 24 h.

## Flow of a bid change

Ads → Bids page → `POST /api/ads/bids/changes` (PENDING) → owner approves (`/decide`) → BullMQ job `ads-bids` (20 s batch) → `applyApprovedBids` → browser step `ads_bids`. That step reads the current bids, writes only the changes still valid (conflicts skipped), reads again to verify, and stores per-change results.

## Persistent state

| Table | Purpose |
|---|---|
| `PlatformConnection` | Login state, `lastError`, `pausedUntil` / `searchPausedUntil` |
| `SyncJob` | One row per sync / bid apply run |
| `ChannelReport` | Raw downloaded payload + import result |
| `ChannelProduct` / `ChannelOrder` / `ChannelInventory` | Seller data |
| `Ad*` | Ads account, campaigns, daily, keyword daily |
| `AdBidChange` | Bid change state machine + verification |
| `ListingSeoSnapshot` / `SearchListingObservation` | SEO |
| `AuditLog` | Every sensitive action |

## Not persistent (known gaps)

| Item | Gap |
|---|---|
| Browser-service job state | In memory (B-05) |
| Browser profiles on live | Depend on an Easypanel volume (B-03) |
