#!/usr/bin/env bash
# Activate a prepared release on the VPS, for the layout that server actually
# uses: /var/www/<app>, systemd units, nginx + Certbot. (deploy/README_AR.md
# documents an /opt/mahad release layout that this host does not have, and
# docker-compose.yml targets a Traefik host it is not — hence a third script
# rather than bending either of those.)
#
#   deploy/vps-activate.sh staging     <release-id>
#   deploy/vps-activate.sh production  <release-id>
#
# Deploy to staging and exercise it before production. Both point at separate
# databases (mahadnafsy_test vs mahadnafsy_db), so migrations on staging cannot
# touch live data.
#
# The current directory is moved aside rather than overwritten, so rollback is a
# rename. If health does not return, this script rolls back on its own.
set -euo pipefail

ENVIRONMENT="${1:-}"
RELEASE="${2:-}"
HOST="${MAHAD_DEPLOY_HOST:-187.55.227.200}"
KEY="${MAHAD_DEPLOY_KEY:-$HOME/.ssh/mahad-local-vps}"

case "$ENVIRONMENT" in
  staging)    APP_DIR=/var/www/mahad-staging/api; SERVICE=mahad-api-staging; PORT=3002 ;;
  production) APP_DIR=/var/www/mahad-api;         SERVICE=mahad-api;         PORT=3001 ;;
  *) echo "usage: vps-activate.sh <staging|production> <release-id>" >&2; exit 64 ;;
esac
[[ -n "$RELEASE" ]] || { echo "usage: vps-activate.sh $ENVIRONMENT <release-id>" >&2; exit 64; }

echo "environment : $ENVIRONMENT"
echo "release     : $RELEASE"
echo "service     : $SERVICE (port $PORT)"
echo

ssh -i "$KEY" -o BatchMode=yes "root@$HOST" "
set -euo pipefail
RELEASE_DIR=/var/www/releases/$RELEASE-api
APP_DIR=$APP_DIR

[[ -d \"\$RELEASE_DIR\" ]] || { echo 'release directory not found — upload and extract it first' >&2; exit 66; }

# Configuration and uploaded media belong to the environment, not the release.
cp -a \"\$APP_DIR/.env\" \"\$RELEASE_DIR/.env\"
[[ -d \"\$APP_DIR/uploads\" ]] && cp -a \"\$APP_DIR/uploads\" \"\$RELEASE_DIR/uploads\" || true

echo '── installing production dependencies'
cd \"\$RELEASE_DIR\"
npm ci --omit=dev --no-audit --no-fund >/dev/null

echo '── applying migrations'
npm run migrate
npm run migrate:verify

echo '── swapping'
PREVIOUS=\"\$APP_DIR.prev-\$(date +%Y%m%d-%H%M%S)\"
mv \"\$APP_DIR\" \"\$PREVIOUS\"
mv \"\$RELEASE_DIR\" \"\$APP_DIR\"
systemctl restart $SERVICE

echo '── waiting for health'
for i in \$(seq 1 20); do
  if curl --fail --silent --max-time 3 http://127.0.0.1:$PORT/api/health >/dev/null; then
    echo \"healthy after \${i}s\"
    echo \"previous release kept at \$PREVIOUS\"
    exit 0
  fi
  sleep 1
done

echo 'health did not return — rolling back' >&2
mv \"\$APP_DIR\" \"\$APP_DIR.failed-\$(date +%s)\"
mv \"\$PREVIOUS\" \"\$APP_DIR\"
systemctl restart $SERVICE
sleep 3
curl --fail --silent --max-time 3 http://127.0.0.1:$PORT/api/health >/dev/null \
  && echo 'rolled back; previous release is serving again' >&2 \
  || echo 'ROLLBACK ALSO UNHEALTHY — investigate now' >&2
exit 75
"

echo
echo "done. exercise $ENVIRONMENT before promoting:"
[[ "$ENVIRONMENT" == staging ]] && echo "  https://staging.mahadnafsy.com  — check checkout and WhatsApp sign-in"
