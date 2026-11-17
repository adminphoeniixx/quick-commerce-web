# Quick Commerce Pulse

Quick-commerce analytics for brands selling on Blinkit, Zepto, Instamart and BigBasket.
Sales, orders, products, inventory, availability and pricing in one dashboard.

- **Live app:** https://dabad-demo-quickcommerce.rmsiry.easypanel.host
- **Login details:** in `ACCESS.local.md` (local file, never committed)
- **Architecture and design decisions:** [ARCHITECTURE.md](ARCHITECTURE.md)

## Contents

1. [What it does](#1-what-it-does)
2. [Tech stack](#2-tech-stack)
3. [Run it locally](#3-run-it-locally)
4. [Build and push a Docker image](#4-build-and-push-a-docker-image)
5. [Deploy on Easypanel](#5-deploy-on-easypanel)
6. [Copy the local database to the server](#6-copy-the-local-database-to-the-server)
7. [Rollback](#7-rollback)
8. [Project structure](#8-project-structure)

---

## 1. What it does

| Area | Where the data comes from |
|---|---|
| **Blinkit connector** | Connections → **Connect Blinkit**: the brand logs in to its own Blinkit seller panel (email/phone + OTP) inside the app. QCP keeps the browser session, never the password or OTP. |
| **Sync** | Runs on connect and on **Sync now**. It pulls these Blinkit reports: Sales Summary (order level, per date range), Product Listing (catalog) and Stock on Hand (inventory). Live progress and a live view of the sync browser are shown. |
| **Blinkit sales, orders & products** | Five pages: Sales analysis, Orders (CSV export), Products (every catalog field), Inventory (per warehouse, stock cover) and Synced reports (original files, retry). |
| **Dashboard, Availability, Pricing, Product catalog** | Built from the same Blinkit data: GMV, units, availability by city, stock-out rate, price/MRP/discount per city, category analytics. |
| **Other platforms** | CSV/Excel uploads in the Import center. |

## 2. Tech stack

| Layer | Choice |
|---|---|
| App | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, Recharts, lucide-react |
| Data | PostgreSQL + Prisma (migrations in `prisma/migrations`) |
| Background jobs | Redis + BullMQ worker (`worker/index.ts`) |
| Blinkit connector | Python, FastAPI and Playwright (Chromium) in `services/browser` |
| Packaging | One Docker image with web, worker and browser connector (`Dockerfile.allinone`) |

## 3. Run it locally

The local stack runs Postgres, Redis, web, worker and browser as separate containers.
It uses `docker-compose.production.yml` with `.env.production`, `.env.browser` and the
compose project name `qcp-docker`.

```bash
cd /Volumes/AmanSSD/Projects/rea-revers/quick-commerce-pulse
docker compose -p qcp-docker -f docker-compose.production.yml up -d --build
open http://localhost:3000
```

Migrations run automatically when the web container starts.

Useful commands:

```bash
docker compose -p qcp-docker -f docker-compose.production.yml ps          # status
docker logs -f qcp-docker-web-1                                            # web logs
docker logs -f qcp-docker-worker-1                                         # sync/import logs
docker logs -f qcp-docker-browser-1                                        # Blinkit connector logs
npx vitest run lib/                                                        # unit tests
npx tsc --noEmit -p .                                                      # type check
```

## 4. Build and push a Docker image

Every build gets a **unique name** from the current date and time, for example
`phoeniixxdesigns/quickcommerce:2026.11.04-121530`.

The image (`Dockerfile.allinone`) runs three processes in one container:

- the web app on port 3000
- the worker
- the Blinkit connector, internal only on `127.0.0.1:8000`

On start it runs `prisma migrate deploy`. If any of the three processes stops, the
container exits so the host restarts it.

### 4.1 One-time setup

```bash
cd /Volumes/AmanSSD/Projects/rea-revers/quick-commerce-pulse
docker login                                                      # Docker Hub user: phoeniixxdesigns
# Builder for amd64 + arm64. Creates it only if it doesn't exist yet (safe to re-run).
docker buildx inspect qcp-multi >/dev/null 2>&1 || docker buildx create --name qcp-multi --driver docker-container
```

### 4.2 Build and push (every release)

```bash
cd /Volumes/AmanSSD/Projects/rea-revers/quick-commerce-pulse

TAG=$(date +%Y.%m.%d-%H%M%S)
echo "Build name: phoeniixxdesigns/quickcommerce:$TAG"

docker buildx build --builder qcp-multi \
  --platform linux/amd64,linux/arm64 \
  -f Dockerfile.allinone \
  -t phoeniixxdesigns/quickcommerce:$TAG \
  --push .
```

- The printed **Build name** is what you set in Easypanel.
- On an Apple-silicon Mac this takes about 10–20 minutes, because the amd64 half is emulated.
- If the server is a normal amd64 VPS, `--platform linux/amd64` is faster.
- Do not move the `latest` tag unless you mean to deploy it. A server may be pulling `latest`.

### 4.3 Check the push and get the build ID

```bash
docker buildx imagetools inspect phoeniixxdesigns/quickcommerce:$TAG
```

`Digest: sha256:…` is the build ID. The `Platform:` lines should list `linux/amd64` and `linux/arm64`.

### 4.4 Optional: test the image locally before pushing

This runs the image against the local Postgres/Redis from step 3:

```bash
docker build -f Dockerfile.allinone -t qcp-allinone .

NET=$(docker inspect qcp-docker-web-1 --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
docker run -d --name qcp-aio --network "$NET" --env-file .env.production \
  -e BROWSER_SERVICE_URL=http://127.0.0.1:8000 -e APP_URL=http://localhost:3100 \
  -p 3100:3000 qcp-allinone

docker logs -f qcp-aio                                        # expect: "Ready", "worker.ready", "Uvicorn running"
docker inspect qcp-aio --format '{{.State.Health.Status}}'    # expect: healthy
open http://localhost:3100
docker rm -f qcp-aio                                          # clean up
```

## 5. Deploy on Easypanel

Project `dabad_demo` has one App service.

| Setting | Value |
|---|---|
| Source | Docker image `phoeniixxdesigns/quickcommerce:<TAG>` (public repo, no registry login) |
| Environment | Paste all of `.env.easypanel`. It has `DATABASE_URL`, `REDIS_URL`, the secrets, and `BROWSER_SERVICE_URL=http://127.0.0.1:8000`. |
| Domain / proxy port | `3000` |
| Volumes | `/data/profiles` (Blinkit login sessions) and `/app/.import-staging` (uploaded files) |
| Command | Leave empty. The image starts everything. |

Then click **Deploy**. After the first deploy on a server:

1. Open the app and log in.
2. Go to **Connections**. If there is no brand yet, create one there.
3. Click **Connect Blinkit** and log in with email/phone + OTP. The first sync starts
   automatically.

Blinkit login sessions live in `/data/profiles`, not in the database, so a new server
always needs this one connect.

## 6. Copy the local database to the server

The server's Postgres hostname (`dabad_demo_quickcommerce-postgress`) only works inside
Easypanel.

1. In Easypanel, expose a public port on the Postgres service.
2. Run the script below.
3. Close the port again.

```bash
TARGET_DATABASE_URL="postgresql://postgres:<password>@<server-ip>:<exposed-port>/dabad_demo" \
  scripts/migrate-db.sh
```

The script:

1. Backs up the server database to `backups/target-<time>.dump`.
2. Replaces the server database with a copy of the local `qcp-docker` database.
3. Prints row counts for both sides.

> ⚠️ The server database is **replaced**. Accounts that exist only on the server
> (for example `admin@quickcommerce.local`) disappear, and local accounts take their place.

## 7. Rollback

- **App:** redeploy the previous image tag in Easypanel.
- **Database:** restore the backup taken by `migrate-db.sh`:

```bash
docker run --rm -i postgres:16-alpine pg_restore --clean --if-exists --no-owner --no-privileges \
  -d "postgresql://postgres:<password>@<server-ip>:<port>/dabad_demo" < backups/target-<time>.dump
```

## 8. Project structure

```
app/                     Next.js pages (app/dashboard/*) and API routes (app/api/*)
  dashboard/seller/      Blinkit sales, orders, products, inventory, synced reports
components/              UI (PageHeader, Sidebar, Header, charts, SyncProgress, BrowserConnectDialog …)
lib/
  channels/              Blinkit file parsers, ingestion, read queries
  connections/           browser-service client, sync runner, schedules
  analytics/             dashboard queries and daily rollups
  ingest/                CSV/Excel import pipeline
prisma/                  schema.prisma + migrations
worker/                  BullMQ worker (imports, syncs)
services/browser/        Blinkit connector (FastAPI + Playwright)
scripts/migrate-db.sh    copy the local database to another Postgres
Dockerfile.allinone      single image: web + worker + connector (used for Easypanel)
Dockerfile.production    web / worker image used by docker-compose.production.yml
agent/                   older experimental GPT agent (not used by the app)
```

| File | Purpose |
|---|---|
| `.env.production` | env for the local Docker stack |
| `.env.browser` | env for the separate local browser container |
| `.env.easypanel` | env to paste into Easypanel |
| `ACCESS.local.md` | live URL and login details (local only) |
