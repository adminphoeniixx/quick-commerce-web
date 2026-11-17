#!/bin/sh
# Starts a dedicated Chrome profile the agent can control (CDP on localhost only).
# Log in to your seller panels in this window once; the login stays in this profile.
PROFILE="${QCP_CHROME_PROFILE:-$HOME/.qcp-agent-chrome}"
PORT="${QCP_CHROME_PORT:-9222}"
exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port="$PORT" \
  --remote-debugging-address=127.0.0.1 \
  --user-data-dir="$PROFILE" \
  --no-first-run \
  "https://seller.blinkit.com/"
