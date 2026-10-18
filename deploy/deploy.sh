#!/usr/bin/env bash
# Manual alternative to the add-on: copy the dashboard into Home Assistant's www folder over SSH.
# Needs the "Advanced SSH & Web Terminal" (or Terminal & SSH) add-on with your key.
# Afterwards open: http://homeassistant.local:8123/local/panda-dashboard/index.html
set -euo pipefail
HOST="${HA_SSH:-root@homeassistant.local}"
PORT="${HA_SSH_PORT:-22}"
DEST="/config/www/panda-dashboard"
cd "$(dirname "$0")/.."

ssh -p "$PORT" "$HOST" "mkdir -p $DEST/data"
tar -cf - -C panda_dashboard/www index.html css js \
  | ssh -p "$PORT" "$HOST" "tar -xf - -C $DEST"
files=$(ls data/energy_monthly.csv data/config.js 2>/dev/null || true)
[ -n "$files" ] && tar -cf - $files | ssh -p "$PORT" "$HOST" "tar -xf - -C $DEST"
echo "Deployed to $HOST:$DEST"
echo "Open http://homeassistant.local:8123/local/panda-dashboard/index.html"
