#!/bin/sh
set -eu

npx prisma migrate deploy

if [ -n "${BOOTSTRAP_ADMIN_EMAIL:-}" ] || [ -n "${BOOTSTRAP_SELLER_EMAIL:-}" ]; then
  if [ -z "${BOOTSTRAP_ADMIN_EMAIL:-}" ] || [ -z "${BOOTSTRAP_ADMIN_PASSWORD:-}" ] || \
     [ -z "${BOOTSTRAP_SELLER_EMAIL:-}" ] || [ -z "${BOOTSTRAP_SELLER_PASSWORD:-}" ]; then
    echo "All BOOTSTRAP_ADMIN_* and BOOTSTRAP_SELLER_* variables are required when account bootstrap is enabled." >&2
    exit 1
  fi
  npm run accounts:bootstrap
fi

exec npm start
