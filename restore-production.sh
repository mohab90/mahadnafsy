#!/usr/bin/env bash
# Restore production to the build that was running before today's deploy.
#
# WHY: production was serving branch claude/review-changes-system-testing-ca20d7,
# which is 78 commits (12-19 Aug) that were never merged into main. Today's
# deploy came from main, so it replaced a week of work - HR recruitment
# controls, interview filters, payment fixes, Paymob reconciliation, the client
# access screen. This puts that build back.
#
# The secrets are NOT reverted. They now live in /etc/mahad/secrets and are
# injected by systemd, and the current .env has the plaintext lines commented
# out. Restoring the old .env would set both the value and the *_FILE var, which
# resolveSecret rejects ("X and X_FILE cannot both be configured") and the API
# would not boot. So the old CODE is restored but the CURRENT .env is kept.
#
# Rolls back automatically if health does not return.
set -uo pipefail
TS=20260820-121708
API=/var/www/mahad-api
health() { curl -s --max-time 15 http://127.0.0.1:3001/api/health 2>/dev/null; }
ok() { health | grep -q '"status":"ok"'; }

for f in api admin client; do
  [ -f "/staging/rollback-PROD-$f-$TS.tgz" ] || { echo "MISSING /staging/rollback-PROD-$f-$TS.tgz - stopping"; exit 1; }
done
echo "backups present"

echo "== keeping current .env =="
cp "$API/.env" /tmp/env.keep
cp "$API/.env" "/staging/env-kept-$(date +%s)"

echo "== restoring API code =="
rm -rf /var/www/mahad-api.mine
mv "$API" /var/www/mahad-api.mine
mkdir -p "$API"
tar -xzf "/staging/rollback-PROD-api-$TS.tgz" -C "$API"
cp /tmp/env.keep "$API/.env"
echo -n "  plaintext secret lines in .env (must be 0): "
grep -cE '^(JWT_SECRET|SESSION_BINDING_SECRET|OTP_HMAC_SECRET|AUDIT_HMAC_SECRET)=' "$API/.env" || true

echo "== restoring statics =="
tar -xzf "/staging/rollback-PROD-admin-$TS.tgz" -C /var/www/admin.mahadnafsy.com
tar -xzf "/staging/rollback-PROD-client-$TS.tgz" -C /var/www/mahadnafsy.com
echo -n "  admin entry now: "; grep -oE 'index-[A-Za-z0-9_-]+\.js' /var/www/admin.mahadnafsy.com/index.html | head -1

echo "== deps =="
cd "$API" || exit 1
npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 || npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1
echo "  done"

echo "== restart =="
systemctl restart mahad-api
sleep 9
echo -n "  active: "; systemctl is-active mahad-api
echo -n "  health: "; health; echo

if ok; then
  echo
  echo "RESTORED. The 12-19 Aug build is live again."
  echo "Your improvements are safe in git (branch main) and can be merged in properly."
else
  echo
  echo "FAILED - rolling back to what was running a moment ago"
  journalctl -u mahad-api -n 15 --no-pager | tail -10
  rm -rf "$API"
  mv /var/www/mahad-api.mine "$API"
  systemctl restart mahad-api && sleep 9
  echo -n "  health after rollback: "; health; echo
  exit 1
fi
