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
# The release to deploy. Passing one as $1 wins; the value here is only the
# fallback. It used to be this line alone, which meant the script accepted an
# argument, ignored it, and deployed whatever was hardcoded — on 2026-08-27 that
# silently rolled production back to an older build, dropping the staff edit
# button and a finance fix until it was noticed and redeployed.
R=${1:-mahad-2fe36419b325}
TS=$(date +%Y%m%d-%H%M%S)

# All three archives, or nothing. On 2026-10-01 the upload failed (scp run from
# a folder that did not hold the release) and this script ran anyway: every tar
# failed, the old code was stamped with the new release name, and staging was
# restarted on it.
for part in api admin client; do
  [ -s "/staging/$R-$part.tgz" ] || {
    echo "MISSING /staging/$R-$part.tgz - upload the release first. Nothing was changed."
    exit 1
  }
done

h()  { curl -s --max-time 15 "http://127.0.0.1:$1/api/health" 2>/dev/null; }
ok() { h "$1" | grep -q '"status":"ok"'; }

# The newest numbered migration a release ships, named the way the runner
# records it (lib/migrationRunner.js sorts the same file names the same way).
shipped_migration() { ls "$1/migrations" 2>/dev/null | grep -E '^[0-9]+.*\.sql$' | LC_ALL=C sort | tail -1; }
# The newest one the database has, as the API itself reports it to 127.0.0.1.
applied_migration() { h "$1" | sed -n 's/.*"migration":"\([^"]*\)".*/\1/p'; }

MIGRATION_LOG=/var/log/mahad-deploy-migrations.log

deploy() { # <label> <apidir> <admindir> <clientdir> <service> <port>
  local label=$1 apidir=$2 admindir=$3 clientdir=$4 svc=$5 port=$6
  echo
  echo "=== $label ==="
  # Uploaded files are not code. Video and branding uploads default to
  # <apidir>/uploads, and every deploy used to copy them twice — into this
  # archive and into $apidir.prev — so every lecture ever uploaded was copied
  # again on each release, onto the disk the database shares. They stay where
  # they are and are carried across a rollback below. Set
  # VIDEO_UPLOAD_DIR (and BRAND_ASSET_DIR / MEDIA_IMAGE_DIR) outside the release
  # dir to take them out of the release's way entirely.
  tar -czf "/staging/rb-$label-api-$TS.tgz" --exclude=./uploads -C "$apidir" . 2>/dev/null
  tar -czf "/staging/rb-$label-admin-$TS.tgz"  -C "$admindir" .  2>/dev/null
  tar -czf "/staging/rb-$label-client-$TS.tgz" -C "$clientdir" . 2>/dev/null
  echo "  rollback saved (tag $TS)"
  grep -q '^VIDEO_UPLOAD_DIR=' "$apidir/.env" 2>/dev/null \
    || echo "  note: VIDEO_UPLOAD_DIR is not set - uploaded videos live inside $apidir/uploads"

  local envcopy
  envcopy=$(mktemp) || { echo "  FAILED - cannot create a temp file; nothing changed"; return 1; }
  cp "$apidir/.env" "$envcopy"
  rm -rf "$apidir.prev"; mkdir -p "$apidir.prev"
  tar -C "$apidir" --exclude=./uploads -cf - . | tar -C "$apidir.prev" -xpf -
  tar -xzf "/staging/$R-api.tgz" --strip-components=1 -C "$apidir"
  cp "$envcopy" "$apidir/.env"; rm -f "$envcopy"

  # Stamp the build into its own environment.
  #
  # APP_RELEASE is what the error monitor and the readiness check use to say
  # which build is running. It was never set, so a report from production named
  # no version, and "is the fix live?" could only be answered by reading files
  # on the box. The release id is already in hand here; the only reason it was
  # missing is that nobody wrote it down.
  #
  # Rewritten rather than appended, because .env is carried across deploys and
  # appending would stack one line per release.
  sed -i '/^APP_RELEASE=/d' "$apidir/.env"
  echo "APP_RELEASE=$R" >> "$apidir/.env"

  ( cd "$apidir" && npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 \
      || npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 )

  # The schema first, then the code — on staging's database, then production's.
  #
  # Migrations used to run after production had already been restarted on the
  # new code, with their output piped through grep and tail, so the script's
  # exit status was tail's: a failed migration left the new code serving an old
  # schema and still printed "DONE". They run here now, while the old process
  # is still the one answering, and a failure stops this deploy before the
  # service, the admin or the site is switched.
  local want
  want=$(shipped_migration "$apidir")
  echo "  migrating the $label database (release ships up to ${want:-none})"
  if ! ( cd "$apidir" && { echo "--- $(date -Iseconds) $label $R"; npm run -s migrate; } >> "$MIGRATION_LOG" 2>&1 ); then
    echo "  MIGRATION FAILED - the $label code, admin and site were not switched"
    tail -n 12 "$MIGRATION_LOG" | sed 's/^/    /'
    rollback_api "$apidir" "$svc" "$port"
    return 1
  fi
  tail -n 1 "$MIGRATION_LOG" | sed 's/^/    /'

  tar -xzf "/staging/$R-admin.tgz"  -C "$admindir"
  tar -xzf "/staging/$R-client.tgz" -C "$clientdir"
  echo -n "  admin entry: "; grep -oE 'index-[A-Za-z0-9_-]+\.js' "$admindir/index.html" | head -1

  systemctl restart "$svc"
  sleep 9
  if ok "$port"; then
    local got
    got=$(applied_migration "$port")
    if [ -n "$want" ] && [ "$got" != "$want" ]; then
      echo "  FAILED - the database reports migration '${got:-none}', the release ships '$want'"
    else
      echo "  OK - $(h "$port")"
      rm -rf "$apidir.prev"
      return 0
    fi
  else
    echo "  FAILED - not healthy"
  fi
  echo "  rolling back"
  journalctl -u "$svc" -n 15 --no-pager | tail -10
  rollback_api "$apidir" "$svc" "$port"
  tar -xzf "/staging/rb-$label-admin-$TS.tgz"  -C "$admindir"
  tar -xzf "/staging/rb-$label-client-$TS.tgz" -C "$clientdir"
  return 1
}

rollback_api() { # <apidir> <service> <port>
  local apidir=$1 svc=$2 port=$3
  # Whatever was uploaded meanwhile moves back with the old code.
  [ -d "$apidir/uploads" ] && mv "$apidir/uploads" "$apidir.prev/uploads"
  rm -rf "$apidir"; mv "$apidir.prev" "$apidir"
  systemctl restart "$svc"; sleep 9
  echo "  restored - $(h "$port")"
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
echo "=== final ==="
echo -n "  service : "; systemctl is-active mahad-api
echo -n "  health  : "; h 3001; echo
echo -n "  restarts: "; systemctl show mahad-api -p NRestarts --value
echo
echo
echo "=== prune old assets ==="
# Each release writes new hashed files and leaves the previous ones behind.
# Seven days is well past any cached index.html still asking for an older
# chunk, and comfortably past the window a rollback would need.
for web in /var/www/mahadnafsy.com/assets /var/www/admin.mahadnafsy.com/assets; do
  [ -d "$web" ] || continue
  before=$(find "$web" -type f | wc -l)
  find "$web" -type f -mtime +7 -delete 2>/dev/null
  after=$(find "$web" -type f | wc -l)
  echo "  $(basename "$(dirname "$web")"): $before -> $after files"
done

echo
echo "=== prune old releases and rollback archives (keeping the last 3) ==="
# Every deploy left six rollback archives and three release archives in
# /staging and nothing ever removed one, so the folder grew by the size of the
# whole site per release until the disk the database lives on filled up.
# Three is the current release plus two to roll back to.
keep_newest() { # <glob> — deletes all but the 3 newest matches
  ls -1t $1 2>/dev/null | tail -n +4 | while read -r old; do rm -f -- "$old" "$old.sha256"; done
}
for label in staging production; do
  for part in api admin client; do keep_newest "/staging/rb-$label-$part-*.tgz"; done
done
ls -1t /staging/mahad-*-api.tgz 2>/dev/null | tail -n +4 | while read -r old; do
  rel=$(basename "$old" -api.tgz)
  [ "$rel" = "$R" ] && continue
  rm -f -- "/staging/$rel-api.tgz" "/staging/$rel-admin.tgz" "/staging/$rel-client.tgz" \
           "/staging/$rel-api.tgz.sha256" "/staging/$rel-admin.tgz.sha256" "/staging/$rel-client.tgz.sha256"
done
echo "  /staging now holds $(du -sh /staging 2>/dev/null | cut -f1)"

echo
echo "=== ops scripts ==="
# The backup script and the weekly restore rehearsal travel with the release
# (release-all.sh uploads them beside this script), so the server runs the
# copy in the repository rather than one somebody edited by hand last year.
if [ -s /staging/mahad-db-backup.sh ] && bash -n /staging/mahad-db-backup.sh; then
  [ -f /usr/local/bin/mahad-db-backup.sh ] && cp -p /usr/local/bin/mahad-db-backup.sh /usr/local/bin/mahad-db-backup.sh.prev
  install -m 0755 /staging/mahad-db-backup.sh /usr/local/bin/mahad-db-backup.sh
  echo "  installed /usr/local/bin/mahad-db-backup.sh"
fi
if [ -s /staging/mahad-restore-rehearsal ] && [ -d /etc/cron.d ]; then
  install -m 0644 /staging/mahad-restore-rehearsal /etc/cron.d/mahad-restore-rehearsal
  echo "  installed /etc/cron.d/mahad-restore-rehearsal (weekly restore rehearsal)"
fi
echo "DONE - release $R live on staging and production."
