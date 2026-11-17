#!/bin/bash
# Supervisor for Dockerfile.allinone: migrations, then web + worker + browser service.
# If any of the three exits, the others are stopped and the container exits, so the
# host's restart policy brings everything back together.
set -euo pipefail

# Root only fixes volume ownership (hosts mount volumes root-owned), then re-runs as pwuser.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/.import-staging "${PROFILE_DIR:-/data/profiles}"
  chown -R pwuser:pwuser /app/.import-staging "${PROFILE_DIR:-/data/profiles}"
  HOME=/home/pwuser exec setpriv --reuid=pwuser --regid=pwuser --init-groups "$0" "$@"
fi

cd /app
# The browser service is container-internal, so a missing shared token can be generated.
if [ -z "${BROWSER_SERVICE_TOKEN:-}" ]; then
  BROWSER_SERVICE_TOKEN="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
fi
export BROWSER_SERVICE_TOKEN

npx prisma migrate deploy

if [ -n "${BOOTSTRAP_ADMIN_EMAIL:-}" ] || [ -n "${BOOTSTRAP_SELLER_EMAIL:-}" ]; then
  npm run accounts:bootstrap
fi

pids=()
stop() { kill -TERM "${pids[@]}" 2>/dev/null || true; wait || true; }
trap 'stop; exit 0' TERM INT

(cd /opt/browser && exec xvfb-run -a -s "-screen 0 1280x800x24" uvicorn app:app --host 127.0.0.1 --port 8000) &
pids+=($!)
npm run worker &
pids+=($!)
npm start &
pids+=($!)

set +e
wait -n
code=$?
echo "qcp-start: a process exited (code $code); stopping the container" >&2
stop
exit "$code"
