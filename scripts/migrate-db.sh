#!/bin/sh
# Copy the local QCP database (docker compose "qcp-docker" stack) into another Postgres.
# The target is backed up first, then replaced by an exact copy of the source.
#
#   TARGET_DATABASE_URL="postgresql://user:pass@host:port/db" scripts/migrate-db.sh
#
# Optional: SOURCE_CONTAINER (default qcp-docker-postgres-1), SOURCE_DB/SOURCE_USER (qcp/qcp),
# BACKUP_DIR (default ./backups). Uses the postgres:16 image for pg_dump/pg_restore so the
# client version always matches the server.
set -eu

: "${TARGET_DATABASE_URL:?set TARGET_DATABASE_URL}"
SOURCE_CONTAINER="${SOURCE_CONTAINER:-qcp-docker-postgres-1}"
SOURCE_DB="${SOURCE_DB:-qcp}"
SOURCE_USER="${SOURCE_USER:-qcp}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
TS="$(date +%Y%m%d-%H%M%S)"
# libpq does not understand Prisma's ?schema= parameter.
TARGET="$(printf '%s' "$TARGET_DATABASE_URL" | sed -E 's/[?&]schema=[^&]*//')"
PG="docker run --rm -i postgres:16-alpine"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

echo "1/4 Checking target connection…"
$PG psql "$TARGET" -tAc "select current_database() || ' on ' || split_part(version(), ' ', 2)"

echo "2/4 Backing up target → $BACKUP_DIR/target-$TS.dump"
$PG pg_dump "$TARGET" -Fc --no-owner --no-privileges > "$BACKUP_DIR/target-$TS.dump"

echo "3/4 Dumping source ($SOURCE_CONTAINER/$SOURCE_DB) → $BACKUP_DIR/source-$TS.dump"
docker exec "$SOURCE_CONTAINER" pg_dump -U "$SOURCE_USER" -d "$SOURCE_DB" -Fc --no-owner --no-privileges > "$BACKUP_DIR/source-$TS.dump"

echo "4/4 Replacing target with source…"
# Drop everything in public first so tables that exist only in the target don't linger.
$PG psql "$TARGET" -v ON_ERROR_STOP=1 -qc "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
$PG pg_restore --no-owner --no-privileges --single-transaction --exit-on-error -d "$TARGET" < "$BACKUP_DIR/source-$TS.dump"

echo "Row counts (source → target):"
for t in User Organization Brand Sku ImportJob ChannelOrder ChannelProduct ChannelReport DailyMetric _prisma_migrations; do
  s=$(docker exec "$SOURCE_CONTAINER" psql -U "$SOURCE_USER" -d "$SOURCE_DB" -tAc "select count(*) from \"$t\"")
  d=$($PG psql "$TARGET" -tAc "select count(*) from \"$t\"")
  printf '  %-20s %8s → %-8s %s\n' "$t" "$s" "$d" "$([ "$s" = "$d" ] && echo ok || echo MISMATCH)"
done
echo "Done. Target backup kept at $BACKUP_DIR/target-$TS.dump"
