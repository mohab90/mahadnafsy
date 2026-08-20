#!/usr/bin/env bash
# Finish the Mahad production deploy.
#
# Two steps, each verified, each with automatic rollback if health does not come
# back. Safe to re-run: every step checks its own current state first.
#
#   step 1  move the four auth/audit secrets from .env to systemd credentials
#   step 2  swap in the new API build
#
# The secret VALUES are not changed anywhere in here - they were already copied
# byte-for-byte to /etc/mahad/secrets and checksum-verified. Sessions survive.
set -uo pipefail

API=/var/www/mahad-api
DROPIN=/etc/systemd/system/mahad-api.service.d/secrets.conf
ENVBAK=$(ls -1t /staging/prod-env-before-credmigration-* 2>/dev/null | head -1)

say() { printf '\n=== %s\n' "$1"; }
health() { curl -s --max-time 15 http://127.0.0.1:3001/api/health 2>/dev/null; }
ok() { health | grep -q '"status":"ok"'; }

say "pre-flight"
for f in jwt session otp audit; do
  [ -s "/etc/mahad/secrets/$f" ] || { echo "MISSING /etc/mahad/secrets/$f - stopping"; exit 1; }
done
echo "  secret files present"
[ -d /var/www/mahad-api.broken ] && echo "  new API build staged at /var/www/mahad-api.broken"
echo -n "  current health: "; health; echo

# ---------------------------------------------------------------- step 1
say "step 1 - systemd credential injection"
if [ -f "$DROPIN" ] && ! grep -qE '^(JWT_SECRET|SESSION_BINDING_SECRET|OTP_HMAC_SECRET|AUDIT_HMAC_SECRET)=' "$API/.env"; then
  echo "  already applied, skipping"
else
  install -D -m0644 /staging/mahad-api-secrets.conf "$DROPIN"
  cp "$API/.env" "/staging/env-rollback-step1-$(date +%s)"
  sed -i -E 's/^(JWT_SECRET|SESSION_BINDING_SECRET|OTP_HMAC_SECRET|AUDIT_HMAC_SECRET)=/#moved-to-systemd-cred \1=/' "$API/.env"
  systemctl daemon-reload
  systemctl restart mahad-api
  sleep 8
  if ok; then
    echo "  OK - $(health)"
  else
    echo "  FAILED - rolling back step 1"
    journalctl -u mahad-api -n 15 --no-pager | tail -8
    rm -f "$DROPIN"
    cp "$ENVBAK" "$API/.env"
    systemctl daemon-reload && systemctl restart mahad-api && sleep 8
    echo "  restored: $(health)"
    exit 1
  fi
fi

# ---------------------------------------------------------------- step 2
say "step 2 - new API build"
if [ ! -d /var/www/mahad-api.broken ]; then
  echo "  no staged build at /var/www/mahad-api.broken, skipping"
else
  cp "$API/.env" /staging/env-keep-$(date +%s)
  rm -rf /var/www/mahad-api.prev
  cp -a "$API" /var/www/mahad-api.prev
  cp -a "$API/.env" /var/www/mahad-api.broken/.env
  rm -rf "$API" && mv /var/www/mahad-api.broken "$API"
  systemctl restart mahad-api
  sleep 8
  if ok; then
    echo "  OK - $(health)"
    rm -rf /var/www/mahad-api.prev
  else
    echo "  FAILED - rolling back to previous build"
    journalctl -u mahad-api -n 15 --no-pager | tail -8
    rm -rf /var/www/mahad-api.broken
    mv "$API" /var/www/mahad-api.broken
    mv /var/www/mahad-api.prev "$API"
    systemctl restart mahad-api && sleep 8
    echo "  restored: $(health)"
    exit 1
  fi
fi

say "done"
echo -n "  service: "; systemctl is-active mahad-api
echo -n "  health : "; health; echo
echo -n "  restarts since boot: "; systemctl show mahad-api -p NRestarts --value
