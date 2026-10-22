#!/usr/bin/env bash
# Deploys one uploaded release (/staging/<release>-{api,admin,client}.tgz) on
# the /var/www + systemd server. deploy/release-all.sh uploads it and runs this.
#
#   MAHAD_DEPLOY_TARGET=staging    bash deploy-release.sh <release>
#   MAHAD_DEPLOY_TARGET=production bash deploy-release.sh <release>
#   bash deploy-release.sh <release>          (both, staging first)
#
# The two halves are separate so the laptop can run the browser checks against
# staging between them (12 Oct 2026): until then the public smoke and payment
# flow specs only ran after production was already live, so a failure could
# only be reported, never prevented. Production mode refuses unless staging is
# healthy and already runs this same release, so it can only ever ship what
# staging was tested with — the same archive, never a rebuild.
#
# Each half migrates its own database before switching its code, checks the
# API reports the newest migration the release ships, and rolls back by itself.
#
# The API is built beside the running one, not over it (21 Oct 2026). The
# release used to be extracted over <apidir> and `npm ci` then wiped its
# node_modules while that process was still serving, so every deploy answered
# 502s (and half-loaded modules) for as long as the install took. Now:
#   1. <apidir>.next = a copy of <apidir> (without uploads and node_modules,
#      so files the server keeps there survive as before) + the release
#      extracted over it + the same .env; its dependencies are installed there
#      while the old process keeps answering;
#   2. migrations run from <apidir>.next — a failure deletes it and the
#      running code was never touched, so nothing needs restarting;
#   3. two renames swap the folders (<apidir> -> <apidir>.prev,
#      <apidir>.next -> <apidir>), uploads move across, one restart — or,
#      with extra web instances enabled on the server, a rolling restart that
#      keeps one answering throughout (deploy/MULTI_INSTANCE.md).
# The path systemd starts from never changes, so the units on the server
# (WorkingDirectory=/var/www/...) need nothing. <apidir>.prev is kept after a
# good deploy for an instant manual rollback (until the next deploy):
#   mv <apidir>/uploads <apidir>.prev/ && mv <apidir> <apidir>.bad \
#     && mv <apidir>.prev <apidir> && systemctl restart <service>
# A rollback never un-migrates the database: migrations are additive, so the
# previous code runs on the newer schema; the backup release-all.sh takes just
# before each half is the way back from a migration itself.
set -uo pipefail
# The release to deploy. Passing one as $1 wins; the value here is only the
# fallback. It used to be this line alone, which meant the script accepted an
# argument, ignored it, and deployed whatever was hardcoded — on 2026-08-27 that
# silently rolled production back to an older build, dropping the staff edit
# button and a finance fix until it was noticed and redeployed.
R=${1:-mahad-2fe36419b325}
TS=$(date +%Y%m%d-%H%M%S)

# "both" stays the default so an operator running it by hand keeps the old
# one-shot behaviour; release-all.sh always names the half it wants.
TARGET=${MAHAD_DEPLOY_TARGET:-both}
case "$TARGET" in
  staging|production|both) ;;
  *) echo "MAHAD_DEPLOY_TARGET must be staging, production or both (got '$TARGET'). Nothing was changed."; exit 1 ;;
esac

STAGING_API=/var/www/mahad-staging/api
STAGING_PORT=3002

# All three archives, or nothing. On 2026-10-01 the upload failed (scp run from
# a folder that did not hold the release) and this script ran anyway: every tar
# failed, the old code was stamped with the new release name, and staging was
# restarted on it.
for part in api admin client; do
  [ -s "/staging/$R-$part.tgz" ] || {
    echo "MISSING /staging/$R-$part.tgz - upload the release first. Nothing was changed."
    exit 1
  }
  # The bytes staging is tested with are the bytes production gets: the laptop
  # uploads a .sha256 beside each archive, and an archive that no longer
  # matches it was replaced or damaged between the two halves.
  if [ -s "/staging/$R-$part.tgz.sha256" ] \
     && ! ( cd /staging && sha256sum --check --status "$R-$part.tgz.sha256" ); then
    echo "CHECKSUM MISMATCH for /staging/$R-$part.tgz - not the archive that was uploaded. Nothing was changed."
    exit 1
  fi
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

  # The new release is assembled in its own folder; see the header. The
  # previous deploy's kept folder goes first, so the disk never holds more
  # than two installed releases — the same as when <apidir>.prev was a copy.
  local next="$apidir.next"
  rm -rf "$apidir.prev" "$next"; mkdir -p "$next"
  if ! { tar -C "$apidir" --exclude=./uploads --exclude=./node_modules -cf - . | tar -C "$next" -xpf -; } \
     || ! tar -xzf "/staging/$R-api.tgz" --strip-components=1 -C "$next"; then
    echo "  FAILED - cannot assemble the new release in $next (disk full?); nothing changed"
    rm -rf "$next"; return 1
  fi
  cp -p "$apidir/.env" "$next/.env"

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
  sed -i '/^APP_RELEASE=/d' "$next/.env"
  echo "APP_RELEASE=$R" >> "$next/.env"

  # Installed into the new folder only: the running process keeps its own
  # node_modules until the swap. A failed install now stops here instead of
  # restarting onto half a dependency tree.
  if ! ( cd "$next" && { npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 \
      || npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1; } ); then
    echo "  FAILED - npm could not install the release's dependencies; nothing changed"
    rm -rf "$next"; return 1
  fi

  # The schema first, then the code — on staging's database, then production's.
  #
  # Migrations used to run after production had already been restarted on the
  # new code, with their output piped through grep and tail, so the script's
  # exit status was tail's: a failed migration left the new code serving an old
  # schema and still printed "DONE". They run here now, while the old process
  # is still the one answering, and a failure stops this deploy before the
  # service, the admin or the site is switched.
  local want
  want=$(shipped_migration "$next")
  echo "  migrating the $label database (release ships up to ${want:-none})"
  if ! ( cd "$next" && { echo "--- $(date -Iseconds) $label $R"; npm run -s migrate; } >> "$MIGRATION_LOG" 2>&1 ); then
    echo "  MIGRATION FAILED - the $label code, admin and site were not switched"
    tail -n 12 "$MIGRATION_LOG" | sed 's/^/    /'
    # The old process never stopped and its folder was never touched.
    rm -rf "$next"
    return 1
  fi
  tail -n 1 "$MIGRATION_LOG" | sed 's/^/    /'

  # --touch: every file of the release is dated now, not when it was built.
  # Asset names are content hashes, so an unchanged chunk keeps its name from
  # release to release; the -mtime pruning below must see it as current. With
  # the archive's dates, a release built (or held on staging) over a week
  # before production would have had its own live chunks pruned.
  tar -xzf "/staging/$R-admin.tgz" --touch -C "$admindir"
  tar -xzf "/staging/$R-client.tgz" --touch -C "$clientdir"
  echo -n "  admin entry: "; grep -oE 'index-[A-Za-z0-9_-]+\.js' "$admindir/index.html" | head -1

  # The swap: two renames on one filesystem, then the single restart. The old
  # process keeps its open files across the rename until it is restarted.
  # Git does not ship uploads/, so the release has none to merge; this only
  # guards against an archive that someday does.
  if [ -d "$next/uploads" ]; then
    mkdir -p "$apidir/uploads"
    cp -an "$next/uploads/." "$apidir/uploads/" 2>/dev/null
    rm -rf "$next/uploads"
  fi
  if ! mv "$apidir" "$apidir.prev"; then
    echo "  FAILED - cannot move $apidir aside; the running code is unchanged"
    rm -rf "$next"; restore_static "$label" "$admindir" "$clientdir"; return 1
  fi
  if ! mv "$next" "$apidir"; then
    echo "  FAILED - cannot move the new release into place; putting the old one back"
    mv "$apidir.prev" "$apidir"; rm -rf "$next"; restore_static "$label" "$admindir" "$clientdir"; return 1
  fi
  { [ -e "$apidir.prev/uploads" ] || [ -L "$apidir.prev/uploads" ]; } && mv "$apidir.prev/uploads" "$apidir/uploads"
  # One unit: the single restart, exactly as before. Extra web instances
  # enabled on the server (deploy/MULTI_INSTANCE.md): one at a time, each
  # answering before the next goes down, so nginx always has one to send to.
  local instances healthy=0
  instances=$(web_instances "$svc")
  if [ -z "$instances" ]; then
    systemctl restart "$svc"
    restart_worker "$svc"
    sleep 9
    ok "$port" && healthy=1
  else
    rolling_restart "$svc" "$port" $instances && healthy=1
  fi
  if [ "$healthy" = 1 ]; then
    local got
    got=$(applied_migration "$port")
    if [ -n "$want" ] && [ "$got" != "$want" ]; then
      echo "  FAILED - the database reports migration '${got:-none}', the release ships '$want'"
    else
      echo "  OK - $(h "$port")"
      echo "  previous release kept at $apidir.prev (removed by the next deploy)"
      return 0
    fi
  else
    echo "  FAILED - not healthy"
  fi
  echo "  rolling back"
  journalctl -u "$svc" -n 15 --no-pager | tail -10
  rollback_api "$apidir" "$svc" "$port"
  restore_static "$label" "$admindir" "$clientdir"
  return 1
}

# Extra web instances of <service>: deploy/systemd/<service>@.service, one per
# port (mahad-api@3011 listens on 3011), enabled by hand as
# deploy/MULTI_INSTANCE.md says. None enabled — the default — means the single
# unit and the single restart above.
web_instances() { # <service>
  systemctl list-units --all --plain --no-legend --type=service "$1@*.service" 2>/dev/null \
    | awk '{print $1}' | grep -E "^$1@[0-9]+\.service$" | sed 's/\.service$//' \
    | while read -r unit; do
        systemctl is-enabled --quiet "$unit" 2>/dev/null && echo "$unit"
      done
  return 0
}

# Up to about a minute for an instance to answer /api/health with "ok". While
# it drains and restarts, nginx sends its requests to the others
# (proxy_next_upstream, deploy/nginx/mahad-api-multi.conf.example).
wait_healthy() { # <port>
  local i
  for i in $(seq 1 45); do
    ok "$1" && return 0
    sleep 1
  done
  return 1
}

# The rolling restart, after the folder swap. Every instance runs from the same
# folder, so from the swap until each one restarts, an old process serves with
# the new release on disk under it: what it already loaded is the old code, but
# a module it requires lazily for the first time — and any file it reads — now
# comes from the new release. That window is kept to the restarts themselves
# (each instance is restarted as soon as the one before answers, a few seconds
# apiece) and is written up in deploy/MULTI_INSTANCE.md. A rollback moves the
# old folder back, which makes an instance not yet restarted whole again.
rolling_restart() { # <service> <port> <instance units...>
  local svc=$1 port=$2 unit p
  shift 2
  echo "  rolling restart: $svc (:$port), then $*"
  systemctl restart "$svc"
  if ! wait_healthy "$port"; then
    echo "  $svc did not answer on :$port"
    return 1
  fi
  for unit in "$@"; do
    p=${unit##*@}
    systemctl restart "$unit"
    if ! wait_healthy "$p"; then
      echo "  $unit did not answer on :$p"
      return 1
    fi
    echo "  $unit answers on :$p"
  done
  restart_worker "$svc"
  return 0
}

# The optional background-jobs process (api/worker.js) runs from the same
# folder, so it follows every switch. Only when someone enabled its unit
# (deploy/systemd/<service>-worker.service); otherwise there is none.
restart_worker() { # <service>
  if systemctl is-enabled --quiet "$1-worker" 2>/dev/null; then
    systemctl restart "$1-worker" && echo "  restarted $1-worker"
  fi
  return 0
}

restore_static() { # <label> <admindir> <clientdir>
  tar -xzf "/staging/rb-$1-admin-$TS.tgz" --touch -C "$2"
  tar -xzf "/staging/rb-$1-client-$TS.tgz" --touch -C "$3"
}

rollback_api() { # <apidir> <service> <port>
  local apidir=$1 svc=$2 port=$3
  # Whatever was uploaded meanwhile moves back with the old code. The database
  # stays migrated (see the header).
  { [ -e "$apidir/uploads" ] || [ -L "$apidir/uploads" ]; } && mv "$apidir/uploads" "$apidir.prev/uploads"
  rm -rf "$apidir"; mv "$apidir.prev" "$apidir"
  local instances
  instances=$(web_instances "$svc")
  if [ -z "$instances" ]; then
    systemctl restart "$svc"; restart_worker "$svc"; sleep 9
  else
    # Every instance back onto the old release, still one at a time.
    rolling_restart "$svc" "$port" $instances || echo "  an instance did not come back - see systemctl status $svc@*"
  fi
  echo "  restored - $(h "$port")"
}

prune_archives() {
  echo
  echo "=== prune old releases and rollback archives (keeping the last 3) ==="
  # Every deploy left six rollback archives and three release archives in
  # /staging and nothing ever removed one, so the folder grew by the size of the
  # whole site per release until the disk the database lives on filled up.
  # Three is the current release plus two to roll back to. The release being
  # deployed is never removed: production still needs it after staging.
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
  # The production sites' old assets are pruned after the production half
  # (below); the staging sites never were, and kept every release's chunks.
  for site in /var/www/staging.mahadnafsy.com /var/www/admin-staging.mahadnafsy.com; do
    [ -d "$site/assets" ] || continue
    before=$(du -sm "$site/assets" 2>/dev/null | cut -f1)
    find "$site/assets" -type f -mtime +7 -delete 2>/dev/null
    echo "  $site/assets: ${before}MB → $(du -sm "$site/assets" 2>/dev/null | cut -f1)MB"
  done
}

if [ "$TARGET" != production ]; then
  deploy staging \
    "$STAGING_API" \
    /var/www/admin-staging.mahadnafsy.com \
    /var/www/staging.mahadnafsy.com \
    mahad-api-staging "$STAGING_PORT" || { echo; echo "STAGING FAILED - production untouched."; exit 1; }
fi

if [ "$TARGET" = staging ]; then
  # Pruned here too: a release the browser checks stop never reaches the
  # production half, and its archives would otherwise pile up in /staging.
  prune_archives
  echo
  echo "DONE - release $R live on STAGING only. Production untouched; it follows with MAHAD_DEPLOY_TARGET=production."
  exit 0
fi

if [ "$TARGET" = production ]; then
  # Production only ever gets what staging already runs and answers for.
  # APP_RELEASE is written into staging's .env by its own deploy above.
  if ! grep -qx "APP_RELEASE=$R" "$STAGING_API/.env" 2>/dev/null; then
    echo "REFUSED - staging does not run $R ($(grep '^APP_RELEASE=' "$STAGING_API/.env" 2>/dev/null || echo 'no APP_RELEASE')). Deploy it to staging and test it there first. Production untouched."
    exit 1
  fi
  if ! ok "$STAGING_PORT"; then
    echo "REFUSED - staging runs $R but is not healthy right now. Production untouched."
    exit 1
  fi
fi

# tools/release-gate.mjs cuts this script at the next line to get a staging-only
# run out of an older server copy, so it stays at column 0 and after the
# staging half.
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
for unit in $(web_instances mahad-api); do
  echo -n "  $unit: "; systemctl is-active "$unit"
done
echo
echo
echo "=== prune old assets ==="
# Each release writes new hashed files and leaves the previous ones behind.
# Seven days is well past any cached index.html still asking for an older
# chunk, and comfortably past the window a rollback would need. Files the
# current release still uses were re-dated when it was extracted (--touch
# above), so a chunk whose content never changed is never pruned.
for web in /var/www/mahadnafsy.com/assets /var/www/admin.mahadnafsy.com/assets; do
  [ -d "$web" ] || continue
  before=$(find "$web" -type f | wc -l)
  find "$web" -type f -mtime +7 -delete 2>/dev/null
  after=$(find "$web" -type f | wc -l)
  echo "  $(basename "$(dirname "$web")"): $before -> $after files"
done

prune_archives

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
if [ -s /staging/mahad-db-backup ] && [ -d /etc/cron.d ]; then
  install -m 0644 /staging/mahad-db-backup /etc/cron.d/mahad-db-backup
  echo "  installed /etc/cron.d/mahad-db-backup (hourly verified backup, shipped off-site)"
  # A schedule made by hand before this one would now run the dump twice.
  if crontab -l 2>/dev/null | grep -q 'mahad-db-backup'; then
    echo "  NOTE: root's own crontab also runs mahad-db-backup — remove that line (crontab -e); /etc/cron.d/mahad-db-backup replaces it"
  fi
fi
if [ -s /staging/mahad-restore-rehearsal ] && [ -d /etc/cron.d ]; then
  install -m 0644 /staging/mahad-restore-rehearsal /etc/cron.d/mahad-restore-rehearsal
  echo "  installed /etc/cron.d/mahad-restore-rehearsal (weekly restore rehearsal)"
fi
# Off-site copies (deploy/OFFSITE_BACKUPS.md). Installed everywhere and idle
# until /etc/mahad/offsite.env exists, so a server without a bucket is
# unchanged. Binary logging needs a MariaDB restart, so it is never switched on
# here — only reported, every deploy, until someone does.
if [ -s /staging/mahad-offsite.sh ] && bash -n /staging/mahad-offsite.sh; then
  install -m 0755 /staging/mahad-offsite.sh /usr/local/bin/mahad-offsite
  echo "  installed /usr/local/bin/mahad-offsite"
  if [ -s /staging/mahad-offsite ] && [ -d /etc/cron.d ]; then
    install -m 0644 /staging/mahad-offsite /etc/cron.d/mahad-offsite
    echo "  installed /etc/cron.d/mahad-offsite (binlogs every 15 min, uploads nightly, retention, monthly rehearsal)"
  fi
  if [ -s /staging/60-mahad-binlog.cnf ]; then
    mkdir -p /usr/local/share/mahad
    install -m 0644 /staging/60-mahad-binlog.cnf /usr/local/share/mahad/60-mahad-binlog.cnf
  fi
  if [ -f /etc/mahad/offsite.env ]; then
    echo "  off-site copies: ON - last dump upload: $(/usr/local/bin/mahad-offsite status 2>/dev/null | sed -n 's/^push-dump *: //p')"
  else
    echo "  NOTE: off-site copies are OFF - /etc/mahad/offsite.env does not exist (deploy/OFFSITE_BACKUPS.md)"
  fi
  if [ "$(timeout 10 mysql -u root -N -B -e 'SELECT @@log_bin' 2>/dev/null)" != "1" ]; then
    echo "  NOTE: MariaDB binary logs are OFF - a restore can only go back to the last hourly dump, not to a minute."
    echo "        Switching on needs one MariaDB restart: deploy/OFFSITE_BACKUPS.md, or the steps at the top of"
    echo "        /usr/local/share/mahad/60-mahad-binlog.cnf"
  fi
fi
echo "DONE - release $R live on staging and production."
