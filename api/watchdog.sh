#!/usr/bin/env sh
set -eu

# Probe only. Process restart is owned by systemd/container/hosting.
HEALTH_URL="${WATCHDOG_HEALTH_URL:-http://127.0.0.1:3001/api/health}"
curl --fail --silent --show-error --max-time 8 "$HEALTH_URL" >/dev/null
