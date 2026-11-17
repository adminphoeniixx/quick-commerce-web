# Architecture — Quick Commerce Pulse (SaaS)

Status: **Priority 5 advanced imports implemented (deployment verification pending).** This document is the source of
truth for decisions; it is updated as phases land.

## 1. Product

A multi-tenant, public-subscription **Quick-Commerce Analytics SaaS**. Brands (or
agencies managing many brands) sign up, connect authorized data sources, and get
analytics on sales, inventory, pricing/competition, and forecasts across Blinkit,
Zepto, Swiggy Instamart and BigBasket.

- **Tenancy:** public signup → organizations → brands. A user can belong to many
  organizations via memberships (RBAC per org). Platform-level super admin.
- **Legitimacy:** no scraping or interception of third-party systems. Data comes
  from authorized seller-panel exports (CSV/Excel), authorized platform APIs where
  they exist, and licensed feeds. Integrations are never shown "live" until
  connectivity is verified. Mock data is dev/test fixtures only, never served as
  real analytics in production.

## 2. Stack (decided)

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | Next.js 14 App Router, React, TS, Tailwind, Recharts | Reuse existing `quick-commerce-pulse`; dcluttr's own app stack |
| API | **Next.js route handlers** (`app/api/*`) | Monolith, one deployable, no premature microservices (reuses the frontend app) |
| ORM / DB | **Prisma + PostgreSQL** | Type-safe, migrations, strong multi-tenant modeling |
| Background jobs | **BullMQ + Redis** (separate `worker` process) | Scheduled sync, retries, dead-letter — off the request path |
| Auth | Credentials + JWT access + rotating refresh (argon2 hashing, `jose` for JWT) | Standard, self-hosted, no vendor lock; Clerk/next-auth remain drop-in alternatives |
| Billing | Razorpay or Stripe (webhook-verified) | Decided in Phase 7 |
| Infra | Docker Compose (dev), container deploy + CI/CD (Phase 8) | Portable; cloud provider chosen in Phase 8 |

**Alternative noted:** if the API outgrows the monolith (heavy CPU analytics,
separate scaling), extract a NestJS service later. Not needed now.

## 3. Multi-tenancy & isolation

- Every tenant-scoped row carries `orgId`. All queries filter by the caller's
  `orgId` (derived from the session, never from client input).
- Access is authorized through `Membership(userId, orgId, role)`. Roles:
  `SUPER_ADMIN` (platform, on `User`), `ORG_ADMIN`, `ANALYST`, `VIEWER` (per org).
- A thin data-access layer injects `orgId` into every query so isolation is not
  left to individual call sites.

## 4. Data model (grain matters)

Fact tables and their **exact grain** (to prevent double-counting):

| Table | Grain (one row per …) |
|-------|------------------------|
| `DailyMetric` | listing × date |
| `AvailabilitySnapshot` | listing × city × date |
| `PricingSnapshot` | listing × city × date |
| `ShareOfVoice` | brand × platform × keyword × date |
| `AnalyticsDaily` | org × brand × platform × date (pre-aggregated rollup) |

Dimensions: `Organization`, `User`, `Membership`, `Brand`, `Platform`, `City`,
`Sku`, `PlatformListing`, `Keyword`, `Competitor`.
SaaS/ops: `PlatformConnection`, `ImportJob`, `ImportError`, `SyncJob`, `Plan`,
`Subscription`, `Invoice`, `Alert`, `AlertRule`, `Report`, `ReportSchedule`,
`AuditLog`, `RefreshToken`, `VerificationToken`.

Full definitions live in `prisma/schema.prisma`. Legacy `db/schema.sql` is kept
as the original design reference.

## 5. Ingestion (adapter architecture)

```
Source (CSV/Excel | authorized API | licensed feed)
  → Adapter (parse + field-map + normalize)
    → Validation (zod) + dedupe (idempotency key)
      → staging → fact tables
        → AnalyticsDaily rollup (BullMQ job)
```

- Idempotent: each source row maps to a deterministic key; re-imports upsert, not
  duplicate.
- Every import produces an `ImportJob` with row counts, errors (`ImportError`),
  source timestamp and freshness.
- `PlatformConnection` holds connector state. **No third-party password is stored
  in plaintext** — secrets are encrypted at rest (envelope encryption) and a
  connection is marked `connected` only after a verification call succeeds.

## 6. Phased roadmap

- **P4 Foundation** (now): Prisma schema + migrations, Docker (Postgres+Redis),
  DB client, env docs. → *next:* auth, orgs, RBAC, audit logs.
- **P5 Data pipeline**: CSV/Excel import UI + adapters, validation, dedupe,
  import history; connector stubs (verified-only).
- **P6 Analytics**: replace mock selectors with real SQL aggregations + rollups;
  sales, inventory, pricing; then forecasting/anomaly with confidence intervals.
- **P7 SaaS**: subscriptions/billing, reports (PDF/Excel), alerts/notifications,
  admin.
- **P8 Production**: security hardening, tests, CI/CD, monitoring, backups.

Each phase keeps the app runnable and ships its own tests.

## 7. Background processing (BullMQ)

Heavy ingestion + aggregation run in a **dedicated worker process** (`worker/index.ts`),
off the HTTP path, backed by Redis + BullMQ.

- **Flow:** `POST /api/imports` validates → stages the file (`.import-staging/<orgId>/`)
  → creates an `ImportJob` (QUEUED) → enqueues `qcp-import` → returns `202 { importJobId }`.
  The worker reads the file, parses, ingests (reusing the `*Core` functions),
  finalizes the job, runs `aggregateBrand` inline, and deletes the staged file.
- **Queues:** `qcp-import` (concurrency `IMPORT_CONCURRENCY`, default 4),
  `qcp-aggregation` (2), `qcp-scheduled` (1).
- **Retry:** exponential backoff, `JOB_MAX_ATTEMPTS` (default 3). On the final
  failed attempt the `ImportJob` is marked `DEAD_LETTERED`; intermediate failures
  are `RETRY_SCHEDULED`. `POST /api/imports/:id/retry` (re-authorized) re-enqueues.
- **Idempotency:** deterministic BullMQ jobId `import:<id>` (duplicate-protected);
  a job already `SUCCESS` is skipped; all upserts are idempotent.
- **Fallback:** with no `REDIS_URL`, imports process inline in the request (same
  code path) so dev works without a worker.
- **Scheduled sync** (`SyncSchedule`): platforms with a browser connector (Blinkit)
  sync on connect and on demand (see §7a); no schedules are created for them. Other platforms have no live API
  connector, so a fired schedule records `blocked: no authorized connector`.

## 7a. Browser connector (Blinkit)

The brand connects its own seller account. QCP never stores a password or OTP.

- **Service:** `services/browser` (FastAPI + Playwright Chromium under Xvfb) runs on the
  internal network only (no published port), authenticated with `BROWSER_SERVICE_TOKEN`.
  Each connection gets its own persistent Chrome profile in the `browser_profiles` volume.
  The container gets its own `.env.browser` and never sees DB or app secrets.
- **Connect:** Connections → "Connect Blinkit" opens `BrowserConnectDialog`. The app
  polls JPEG frames and forwards clicks and typing (`/api/connections/:id/browser/*`,
  RBAC `integration:update`).
  - Top-level navigation is limited to the platform's domains, and popups are closed.
  - When the panel's dashboard is reached, `finish` saves the session, marks the
    connection `CONNECTED` and queues the first **full** sync. There are no timed syncs.
    After that, data updates on "Sync now", and failed ranges can be retried.
- **What a sync fetches** (Blinkit, deterministic flow, no LLM):
  - **Sales Summary** (order-level), once per range. A full sync takes "Current Month"
    plus every month the panel offers, about 3 months back. "Sync now" takes
    "Current Month" plus "Last 30 days".
  - **Product Listing** (catalog, 37 columns), via Bulk Download.
- **Storage:**
  - `ChannelReport`: every file with its range, rows, status and the original bytes.
  - `ChannelProduct`: catalog, with all columns kept in `details`.
  - `ChannelOrder`: one row per order × item, upserted, so syncs are idempotent.
  - `DailyMetric` is rebuilt from the stored order lines for the covered dates, so the
    dashboard always equals the sum of orders. Cancelled, returned and RTO lines are
    excluded from sales.
- **Pages:** `/dashboard/seller/{sales,orders,products,reports}`, backed by `/api/seller/*`.
- **Failure handling:**
  - Expired login, block or captcha sets the connection to `ERROR` with a reconnect
    message.
  - A range Blinkit fails to generate (its poll returns `FAILED`) is recorded as a failed
    report and the rest of the sync continues.
- **Guardrails:** no stealth or fingerprint spoofing, no captcha solving, no proxies.
  Deleting a connection deletes its browser profile.
- **Known risk:** the platform may block the server's IP or ask for a captcha. Syncs then
  stop with a clear status rather than working around it.

## 7b. Browser connector (Blinkit Ads, brands.blinkit.com)

A separate connection (platform `blinkit-ads`), because the ad account has its own login.

- **Connect:** Connections → "Connect Blinkit Ads". In the remote window the user clicks
  **Log In**, enters their email and presses **Request Sign in Link**. They then paste the
  emailed link into the dialog (`POST /api/connections/:id/browser/link`). The service
  resolves a SendGrid click-tracking wrapper without following it, accepts only
  `*.blinkit.com`, and opens the link in the window. The link is never stored or logged.
- **What a sync fetches** (`services/browser/blinkit_ads.py`): the portal's own read-only
  JSON queries, run inside the logged-in page with the session the SPA uses, throttled.
  - account: wallet, ad credit, festive insights, brand collections, region-id → city map
  - every campaign with its settings (budget, pacing, cities, product ids, keyword bids)
  - campaign × day metrics (13 metrics; a full sync takes 1 year, "Sync now" takes 14 days)
  - campaign × day × keyword reports (full: 30 days, recent: 7)
- **Storage:** `AdAccountSnapshot`, `AdCampaign`, `AdCampaignDaily`, `AdKeywordDaily`. Each
  payload is also kept as a `ChannelReport` (`ads_*` JSON). Daily and keyword windows are
  replaced on every sync, because Blinkit revises yesterday's numbers during the day.
- **Joins:** `AdCampaign.productIds` ↔ `ChannelProduct.productId` (seller catalog).
  TACoS = ad spend ÷ delivered Blinkit seller sales for the same brand and period.
- **Pages:** `/dashboard/ads` (overview, campaigns, campaign detail, keywords, account &
  insights), backed by `/api/ads/*`. Widgets: main dashboard, seller sales (ad spend,
  ROAS, TACoS) and seller products (campaigns per product).
- **Local agent:** the `blinkit_ads_sync` MCP tool runs the same collector in the local agent
  Chrome and posts to `POST /api/ads/import`.

## 8. Running it

### Advanced import lifecycle

Wizard imports use `Upload → STAGED preview → mapped validation → VALIDATED → explicit confirmation → QUEUED → RUNNING → aggregation → terminal status`. Preview and validation never write analytics facts. The confirmed mapping and validation summary are stored on `ImportJob`, and workers use that mapping snapshot.

Wizard files have a seven-day retry retention marker. Production must schedule cleanup of expired staged files. Templates and error downloads are tenant-scoped and RBAC-protected; exported cells that resemble spreadsheet formulas are prefixed safely. `IMPORT_MAX_BYTES` sets the bounded upload size (10 MiB by default), while `IMPORT_STAGING_DIR` selects private storage.

Added APIs: `POST /api/imports/preview`, `POST /api/imports/validate`, `POST /api/imports/confirm`, CRUD under `/api/imports/templates`, and `GET /api/imports/:id/errors`.

```bash
docker compose up -d           # Postgres + Redis
cp .env.example .env           # fill secrets
npm install
npx prisma migrate deploy      # apply migrations
npm run db:seed                # platforms, cities, plans
npm run dev                    # Next.js app (http://localhost:3000)
npm run worker                 # BullMQ worker (separate terminal; needs env)
```
