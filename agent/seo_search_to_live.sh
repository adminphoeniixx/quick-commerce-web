#!/bin/bash
# Runs the live image's browser service locally (no Blinkit login needed) and imports the
# blinkit.com search results for the top Blinkit Ads keywords into the live panel.
set -euo pipefail
AREA="${1:?usage: ./seo_search_to_live.sh \"Sector 50 Gurugram\"}"
HERE="$(cd "$(dirname "$0")" && pwd)"
IMAGE="${QCP_IMAGE:-qcp-allinone}"
docker image inspect "$IMAGE" >/dev/null 2>&1 || docker build -f "$HERE/../Dockerfile.allinone" -t "$IMAGE" "$HERE/.."
docker rm -f qcp-seo-search >/dev/null 2>&1 || true
docker run -d --init --name qcp-seo-search --user pwuser --shm-size 1g -e HOME=/home/pwuser \
  -e BROWSER_SERVICE_TOKEN=testtoken -e PROFILE_DIR=/tmp/profiles -p 127.0.0.1:8100:8000 --entrypoint sh "$IMAGE" \
  -c 'mkdir -p /tmp/profiles && cd /opt/browser && exec xvfb-run -a -s "-screen 0 1280x800x24" uvicorn app:app --host 0.0.0.0 --port 8000' >/dev/null
trap 'docker rm -f qcp-seo-search >/dev/null 2>&1' EXIT
python3 "$HERE/seo_search_to_live.py" "$HERE/../ACCESS.local.md" "$AREA"
