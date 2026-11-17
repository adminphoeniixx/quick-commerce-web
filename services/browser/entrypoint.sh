#!/bin/sh
# Starts as root only to make the profile volume writable (hosts like Easypanel mount it
# root-owned), then drops to pwuser for Xvfb + the service.
set -eu
PROFILE_DIR="${PROFILE_DIR:-/data/profiles}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$PROFILE_DIR"
  chown -R pwuser:pwuser "$PROFILE_DIR"
  HOME=/home/pwuser exec setpriv --reuid=pwuser --regid=pwuser --init-groups "$0" "$@"
fi
exec xvfb-run -a -s "-screen 0 1280x800x24" uvicorn app:app --host 0.0.0.0 --port 8000
