#!/usr/bin/env bash
# Deploy mahad-ddffccd69669: staging first, verify, then production.
#
# This release is built FROM the branch production already runs, with the
# improvements re-applied on top - it is not a different lineage. That is the
# difference from the earlier deploy, which came from main and dropped 78
# commits nobody had merged.
#
# Rolls back automatically if health does not come back.
set -uo pipefail
R=mahad-ddffccd69669
TS=$(date +%Y%m%d-%H%M%S)

h()  { curl -s --max-time 15 "http://127.0.0.1:$1/api/health" 2>/dev/null; }
ok() { h "$1" | grep -q '"status":"ok"'; }

deploy() { # <label> <apidir> <admindir> <clientdir> <service> <port>
  local label=$1 apidir=$2 admindir=$3 clientdir=$4 svc=$5 port=$6
  echo
  echo "=== $label ==="
  tar -czf "/staging/rb-$label-api-$TS.tgz"    -C "$apidir" .    2>/dev/null
  tar -czf "/staging/rb-$label-admin-$TS.tgz"  -C "$admindir" .  2>/dev/null
  tar -czf "/staging/rb-$label-client-$TS.tgz" -C "$clientdir" . 2>/dev/null
  echo "  rollback saved (tag $TS)"

  cp "$apidir/.env" /tmp/env.$label
  rm -rf "$apidir.prev"; cp -a "$apidir" "$apidir.prev"
  tar -xzf "/staging/$R-api.tgz" --strip-components=1 -C "$apidir"
  cp /tmp/env.$label "$apidir/.env"
  tar -xzf "/staging/$R-admin.tgz"  -C "$admindir"
  tar -xzf "/staging/$R-client.tgz" -C "$clientdir"
  echo -n "  admin entry: "; grep -oE 'index-[A-Za-z0-9_-]+\.js' "$admindir/index.html" | head -1

  ( cd "$apidir" && npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 \
      || npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 )
  systemctl restart "$svc"
  sleep 9
  if ok "$port"; then
    echo "  OK - $(h "$port")"
    rm -rf "$apidir.prev"
    return 0
  fi
  echo "  FAILED - rolling back"
  journalctl -u "$svc" -n 15 --no-pager | tail -10
  rm -rf "$apidir"; mv "$apidir.prev" "$apidir"
  tar -xzf "/staging/rb-$label-admin-$TS.tgz"  -C "$admindir"
  tar -xzf "/staging/rb-$label-client-$TS.tgz" -C "$clientdir"
  systemctl restart "$svc"; sleep 9
  echo "  restored - $(h "$port")"
  return 1
}

deploy staging \
  /var/www/mahad-staging/api \
  /var/www/admin-staging.mahadnafsy.com \
  /var/www/staging.mahadnafsy.com \
  mahad-api-staging 3002 || { echo; echo "STAGING FAILED - production untouched."; exit 1; }

echo
echo "staging is healthy; continuing to production"

deploy production \
  /var/www/mahad-api \
  /var/www/admin.mahadnafsy.com \
  /var/www/mahadnafsy.com \
  mahad-api 3001 || { echo; echo "PRODUCTION FAILED - rolled back."; exit 1; }

echo
echo "=== migrations ==="
cd /var/www/mahad-api && npm run migrate 2>&1 | grep -viE 'warn|notice' | tail -5

echo
echo "=== final ==="
echo -n "  service : "; systemctl is-active mahad-api
echo -n "  health  : "; h 3001; echo
echo -n "  restarts: "; systemctl show mahad-api -p NRestarts --value
echo
echo "DONE - release $R live on staging and production."
