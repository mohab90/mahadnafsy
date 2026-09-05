#!/usr/bin/env bash
# Remove what the server is carrying and not using.
#
# Everything nginx serves as a root — admin.mahadnafsy.com, mahadnafsy.com and
# the two staging roots — is left alone, as is every directory a running
# service works from (mahad-api, mahad-staging/api). What goes is deploy
# leftovers nothing references.
#
# Content-hashed assets are the one judgement call. index.html is served
# no-cache and the assets immutable, so no browser holds a stale index and
# nothing will ask for an old chunk except a session that was already open
# when a deploy happened. Three most recent builds are kept on each site,
# including the one the live index.html points at.
#
# A manifest is written before anything is removed.
#
#   bash server-cleanup.sh          # dry run, writes the manifest only
#   bash server-cleanup.sh --apply
set -uo pipefail

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

STAMP=$(date +%Y%m%d-%H%M%S)
MANIFEST="/root/server-cleanup-${STAMP}.txt"
: > "$MANIFEST"

total_bytes=0
total_items=0

note() { echo "$1"; echo "$1" >> "$MANIFEST"; }

# $1 = human label, rest = paths
drop() {
  local label="$1"; shift
  local paths=("$@")
  [ ${#paths[@]} -eq 0 ] && return 0
  local bytes count
  bytes=$(du -sbc "${paths[@]}" 2>/dev/null | tail -1 | cut -f1)
  count=${#paths[@]}
  bytes=${bytes:-0}
  total_bytes=$((total_bytes + bytes))
  total_items=$((total_items + count))
  note "$(printf '%-42s %6s items  %8s MB' "$label" "$count" "$((bytes / 1048576))")"
  printf '%s\n' "${paths[@]}" >> "$MANIFEST"
  if [ "$APPLY" = "1" ]; then
    rm -rf -- "${paths[@]}"
  fi
}

note "server cleanup ${STAMP} (apply=${APPLY})"
note ""

# 1. Deploy backups of the static sites. The code is in git and the current
#    build is live; these are copies of previous ones.
mapfile -t stale_dirs < <(ls -d /var/www/*.old-* /var/www/*.bak 2>/dev/null)
drop "static-site deploy backups" "${stale_dirs[@]}"

# 2. A stray copy of the API, untouched since 20 August, referenced by no
#    service, nginx entry or cron. It carries a .env whose keys are a subset of
#    the live one, so it holds no secret the live file lacks — and it is a
#    second copy of production credentials sitting on disk.
[ -d /var/www/mahad-api.mine ] && drop "stray API copy (mahad-api.mine)" /var/www/mahad-api.mine

# 3. A release bundle from 12 August that nothing activates.
mapfile -t old_releases < <(ls -d /var/www/releases/*/ 2>/dev/null)
drop "unactivated release bundles" "${old_releases[@]}"

# 4. Superseded builds. Keeps the three most recent on each site.
for site in admin.mahadnafsy.com mahadnafsy.com; do
  dir="/var/www/${site}/assets"
  [ -d "$dir" ] || continue
  keep=$(ls "$dir" | sed -nE 's/.*-(20[0-9]{6})[0-9]{4}\..*/\1/p' | sort -u | tail -3)
  live=$(grep -oE 'assets/[A-Za-z0-9_.-]+\.(js|css)' "/var/www/${site}/index.html" 2>/dev/null | sed 's|assets/||' | sort -u)
  mapfile -t doomed < <(
    cd "$dir" || exit 0
    for f in *; do
      stamp=$(echo "$f" | sed -nE 's/.*-(20[0-9]{6})[0-9]{4}\..*/\1/p')
      [ -z "$stamp" ] && continue                       # unstamped: keep
      grep -qx "$stamp" <<< "$keep" && continue          # in a kept build
      grep -qx "$f" <<< "$live" && continue              # referenced right now
      echo "$dir/$f"
    done
  )
  drop "superseded assets — ${site}" "${doomed[@]}"
done

# 5. Empty gzip archives an older backup script left behind: valid .gz files of
#    nothing, which is what a failed mysqldump used to produce. The real
#    backups live in /var/backups/mahad-db and are untouched.
mapfile -t partials < <(ls /var/www/mahad-api/db-backups/*.partial 2>/dev/null)
drop "empty backup archives (.partial)" "${partials[@]}"

# 6. One-off scripts and an index backup left from this session's work. The
#    purge and backfill tools are kept in the repository; these are the copies
#    that were uploaded to run them.
mapfile -t oneoffs < <(ls /var/www/mahad-api/{smoke.mjs,diagnose-*.cjs,verify-*.cjs,backfill-missing-branch.cjs,purge-e2e-smoke-bookings.cjs,deactivate-archived-logins.cjs} /var/www/admin.mahadnafsy.com/index.html.bak-* 2>/dev/null)
drop "one-off scripts and index backups" "${oneoffs[@]}"

note ""
note "$(printf 'TOTAL %s items, %s MB' "$total_items" "$((total_bytes / 1048576))")"
note "manifest: $MANIFEST"
[ "$APPLY" = "1" ] || note "DRY RUN — nothing removed. re-run with --apply"
