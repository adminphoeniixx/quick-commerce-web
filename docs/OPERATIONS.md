# Operations runbook

## Deployment

Copy `.env.example` to `.env.production`, replace every secret, keep PostgreSQL
and Redis off the public network, then run migrations as a one-off release task:

```bash
docker compose -f docker-compose.production.yml build
docker compose -f docker-compose.production.yml run --rm web npx prisma migrate deploy
docker compose -f docker-compose.production.yml up -d
curl --fail http://127.0.0.1:3000/api/health/ready
```

The web and worker must share `import_staging`. `/api/health/live` checks the
process; `/api/health/ready` checks PostgreSQL and Redis. Alert on readiness
failures, worker restarts, failed/dead-letter queue growth, disk use, and backup
age. Do not expose queue metrics without authentication.

## PostgreSQL backup and restore

Create encrypted, access-controlled backups outside the application host and
test restores regularly:

```bash
pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" --file=qcp.dump
createdb qcp_restore_test
pg_restore --no-owner --exit-on-error --dbname=qcp_restore_test qcp.dump
```

Never restore over a live database. Stop writers, restore into a new database,
run consistency checks, then switch the application connection during a planned
maintenance window. Back up the staged-file volume separately for the active
retention window. Redis is a queue, not the system of record.

## Recovery and shutdown

BullMQ reclaims stalled jobs after a worker crash; fact writes are idempotent.
Workers handle SIGTERM/SIGINT, stop accepting work, await active jobs, disconnect
from PostgreSQL/Redis, and force exit after `SHUTDOWN_TIMEOUT_MS` (30 seconds).
Expired retained imports are cleaned on worker startup and every six hours.

## Security limitations

Deployment still requires TLS termination, secret-manager integration, network
policies, container/image scanning, centralized log redaction review, WAF or
distributed rate limiting, restore drills, penetration testing, and load testing
with production-like data sizes.
