#!/bin/bash
# Off-site copies of everything the business cannot rebuild: the hourly
# database dumps, MariaDB's binary logs (point-in-time recovery) and uploads/
# (lecture videos, branding, media). Installed as /usr/local/bin/mahad-offsite
# by deploy-release.sh; deploy/OFFSITE_BACKUPS.md is the runbook.
#
# Until this existed every copy of the database sat on the disk the database
# lives on. The bucket is any S3-compatible store (Cloudflare R2, Backblaze B2,
# AWS S3, Wasabi), described in one root-only file — no interactive
# `rclone config`, so a rebuilt server is configured by copying that file back.
#
#   mahad-offsite test             write, read back and delete a test object
#   mahad-offsite push-dump FILE   encrypt and upload one dump (mahad-db-backup.sh calls it)
#   mahad-offsite ship-binlogs     upload closed binary logs (cron, every 15 minutes)
#   mahad-offsite sync-uploads     upload new or changed uploads (cron, nightly)
#   mahad-offsite prune            off-site retention (cron, nightly)
#   mahad-offsite rehearse         restore the newest off-site dump into a scratch database
#   mahad-offsite fetch-db [NAME|latest] DIR       download and decrypt a dump
#   mahad-offsite fetch-pitr 'YYYY-MM-DD HH:MM:SS' DIR
#                                  the dump and binlogs to rebuild the database
#                                  as it was at that moment, plus the commands
#   mahad-offsite fetch-uploads DIR    every uploaded file, decrypted, under DIR
#   mahad-offsite status           the last result of each job
# --dry-run (anywhere on the line) prints what would be uploaded or deleted.
#
# OFF unless the settings file exists: every command then exits 0 and says
# nothing, so the cron file can be installed on every server.
#
# Everything leaves the machine encrypted (gpg, AES256, the passphrase from the
# settings file): the dumps and binlogs hold every client's phone number, every
# payment and every therapist's note, and a bucket is one leaked key away from
# public. Keep the passphrase somewhere other than this server too — without it
# the off-site copies cannot be opened.
set -u
set -o pipefail

ENV_FILE="${MAHAD_OFFSITE_ENV_FILE:-/etc/mahad/offsite.env}"

DRY_RUN=0
SCHEDULED=0
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --scheduled) SCHEDULED=1 ;;
    *) ARGS+=("$arg") ;;
  esac
done
set -- "${ARGS[@]+"${ARGS[@]}"}"
CMD="${1:-help}"
[ "$#" -gt 0 ] && shift

case "$CMD" in
  help|-h|--help)
    sed -n '2,/^set -u/p' "$0" | grep '^#' | sed 's/^# \{0,1\}//'
    exit 0 ;;
esac

if [ ! -f "$ENV_FILE" ]; then
  # The switch. `status` and `test` are asked by a person, so they answer.
  case "$CMD" in
    status|test) echo "off-site copies are OFF: $ENV_FILE does not exist (deploy/OFFSITE_BACKUPS.md)"; exit 0 ;;
  esac
  exit 0
fi

# Sourced by a root shell and holding the bucket key and the passphrase, so it
# must belong to root (or to whoever runs this) and be readable by nobody else.
OWNER=$(stat -c '%u' "$ENV_FILE")
if { [ "$OWNER" != "0" ] && [ "$OWNER" != "$(id -u)" ]; } || [ -n "$(find "$ENV_FILE" -perm /077)" ]; then
  echo "ALERT mahad-offsite: refusing $ENV_FILE — it must be owned by root and chmod 600" >&2
  command -v logger >/dev/null 2>&1 && logger -p user.err -t mahad-offsite "ALERT refusing $ENV_FILE - it must be owned by root and chmod 600"
  exit 2
fi
set -a; . "$ENV_FILE"; set +a

ENDPOINT="${MAHAD_OFFSITE_ENDPOINT:-}"
BUCKET="${MAHAD_OFFSITE_BUCKET:-}"
REGION="${MAHAD_OFFSITE_REGION:-auto}"
PROVIDER="${MAHAD_OFFSITE_PROVIDER:-Other}"
PREFIX="${MAHAD_OFFSITE_PREFIX:-mahad}"
PREFIX="${PREFIX#/}"; PREFIX="${PREFIX%/}"
TOOL="${MAHAD_OFFSITE_TOOL:-auto}"
PASSPHRASE_FILE="${MAHAD_OFFSITE_PASSPHRASE_FILE:-}"
STATE_DIR="${MAHAD_OFFSITE_STATE_DIR:-/var/lib/mahad-offsite}"
LOG="${MAHAD_OFFSITE_LOG:-/var/log/mahad-offsite.log}"
WEBHOOK="${MAHAD_OFFSITE_ALERT_WEBHOOK_URL:-${ALERT_WEBHOOK_URL:-}}"
API_DIR="${MAHAD_OFFSITE_API_DIR:-/var/www/mahad-api}"
BACKUP_DIR="${MAHAD_BACKUP_DIR:-/var/backups/mahad-db}"
KEEP_HOURLY_DAYS="${MAHAD_OFFSITE_KEEP_HOURLY_DAYS:-7}"
KEEP_DAILY_DAYS="${MAHAD_OFFSITE_KEEP_DAILY_DAYS:-35}"
KEEP_MONTHLY="${MAHAD_OFFSITE_KEEP_MONTHLY:-12}"
KEEP_BINLOG_DAYS="${MAHAD_OFFSITE_KEEP_BINLOG_DAYS:-35}"

mkdir -p "$STATE_DIR" 2>/dev/null; chmod 700 "$STATE_DIR" 2>/dev/null
mkdir -p "$(dirname "$LOG")" 2>/dev/null

log() { echo "$(date -Iseconds) [$CMD] $*" >> "$LOG"; }
say() { log "$*"; echo "$*"; }

# The same three places mahad-db-backup.sh alerts (its log, stderr so cron
# mails it, syslog at user.err), plus the API's incident webhook when one is
# set (ALERT_WEBHOOK_URL, the same JSON shape lib/errorMonitor.js posts).
alert() {
  log "ALERT $*"
  echo "ALERT mahad-offsite: $*" >&2
  command -v logger >/dev/null 2>&1 && logger -p user.err -t mahad-offsite "ALERT $*"
  if [ -n "$WEBHOOK" ] && command -v curl >/dev/null 2>&1; then
    local text
    text=$(printf '%s' "$*" | sed 's/\\/\\\\/g; s/"/\\"/g')
    curl -fsS -m 10 -H 'Content-Type: application/json' \
      -d "{\"text\":\"Incident: off-site backup — $text\",\"title\":\"off-site backup\",\"detail\":\"$text\",\"app\":\"mahad-offsite\",\"ts\":\"$(date -Iseconds)\"}" \
      "$WEBHOOK" >/dev/null 2>>"$LOG" || log "the alert webhook did not answer"
  fi
  return 0
}

# `mahad-offsite status` reads these back.
record() { # <ok|FAILED|off> <detail>
  echo "$1 $(date -Iseconds) $2" > "$STATE_DIR/last-$CMD" 2>/dev/null
}

die() { # a failed run: alerted, recorded, non-zero
  alert "$CMD FAILED: $*"
  record FAILED "$*"
  exit 1
}

TMP=""
cleanup() { [ -n "$TMP" ] && rm -rf "$TMP"; return 0; }
trap cleanup EXIT
private_tmp() {
  # Decrypted dumps pass through here, so nobody but root may look in.
  TMP=$(mktemp -d "${TMPDIR:-/tmp}/mahad-offsite.XXXXXX") || die "cannot create a temporary folder"
  chmod 700 "$TMP"
}

# ── settings ────────────────────────────────────────────────────────────────
require_settings() {
  [ -n "$BUCKET" ] || die "MAHAD_OFFSITE_BUCKET is not set in $ENV_FILE"
  [ -n "${MAHAD_OFFSITE_ACCESS_KEY_ID:-}" ] && [ -n "${MAHAD_OFFSITE_SECRET_ACCESS_KEY:-}" ] \
    || die "MAHAD_OFFSITE_ACCESS_KEY_ID / MAHAD_OFFSITE_SECRET_ACCESS_KEY are not set in $ENV_FILE"
  if [ -n "$PASSPHRASE_FILE" ]; then
    [ -s "$PASSPHRASE_FILE" ] || die "the passphrase file $PASSPHRASE_FILE is missing or empty"
  elif [ -z "${MAHAD_OFFSITE_PASSPHRASE:-}" ]; then
    die "no encryption passphrase (MAHAD_OFFSITE_PASSPHRASE_FILE or MAHAD_OFFSITE_PASSPHRASE) — nothing is ever shipped in clear"
  fi
  command -v gpg >/dev/null 2>&1 || die "gpg is not installed (apt-get install -y gnupg)"
  if [ "$TOOL" = auto ]; then
    if command -v rclone >/dev/null 2>&1; then TOOL=rclone
    elif command -v aws >/dev/null 2>&1; then TOOL=aws
    else die "neither rclone nor the aws CLI is installed (apt-get install -y rclone)"; fi
  fi
  case "$TOOL" in
    rclone|aws) command -v "$TOOL" >/dev/null 2>&1 || die "MAHAD_OFFSITE_TOOL=$TOOL but $TOOL is not installed" ;;
    *) die "MAHAD_OFFSITE_TOOL must be auto, rclone or aws (got $TOOL)" ;;
  esac
  if [ "$TOOL" = rclone ]; then
    # An rclone remote described entirely by the environment: nothing on disk
    # but the settings file, and the key never on a command line.
    export RCLONE_CONFIG_MAHADOFFSITE_TYPE=s3
    export RCLONE_CONFIG_MAHADOFFSITE_PROVIDER="$PROVIDER"
    export RCLONE_CONFIG_MAHADOFFSITE_ACCESS_KEY_ID="$MAHAD_OFFSITE_ACCESS_KEY_ID"
    export RCLONE_CONFIG_MAHADOFFSITE_SECRET_ACCESS_KEY="$MAHAD_OFFSITE_SECRET_ACCESS_KEY"
    export RCLONE_CONFIG_MAHADOFFSITE_REGION="$REGION"
    export RCLONE_CONFIG_MAHADOFFSITE_ENDPOINT="$ENDPOINT"
    # A key limited to one bucket cannot create or check buckets.
    export RCLONE_CONFIG_MAHADOFFSITE_NO_CHECK_BUCKET=true
  else
    export AWS_ACCESS_KEY_ID="$MAHAD_OFFSITE_ACCESS_KEY_ID"
    export AWS_SECRET_ACCESS_KEY="$MAHAD_OFFSITE_SECRET_ACCESS_KEY"
    export AWS_DEFAULT_REGION="$REGION"
  fi
}

# ── the bucket: one small vocabulary over rclone or the aws CLI ─────────────
# Keys are relative to <bucket>/<prefix>/.
url() {
  local key="$1" base="$BUCKET${PREFIX:+/$PREFIX}"
  if [ "$TOOL" = rclone ]; then echo "mahadoffsite:$base/$key"; else echo "s3://$base/$key"; fi
}
aws_s3() { aws ${ENDPOINT:+--endpoint-url "$ENDPOINT"} s3 "$@"; }

put_file() { # <local> <key>
  if [ "$DRY_RUN" = 1 ]; then echo "would upload $2" >&2; return 0; fi
  if [ "$TOOL" = rclone ]; then rclone copyto --no-traverse "$1" "$(url "$2")" </dev/null >>"$LOG" 2>&1
  else aws_s3 cp --only-show-errors "$1" "$(url "$2")" </dev/null >>"$LOG" 2>&1; fi
}
put_stream() { # <key>  (stdin)
  if [ "$DRY_RUN" = 1 ]; then cat >/dev/null; echo "would upload $1" >&2; return 0; fi
  if [ "$TOOL" = rclone ]; then rclone rcat "$(url "$1")" >>"$LOG" 2>&1
  else aws_s3 cp --only-show-errors - "$(url "$1")" >>"$LOG" 2>&1; fi
}
get_file() { # <key> <local>
  if [ "$TOOL" = rclone ]; then rclone copyto "$(url "$1")" "$2" </dev/null >>"$LOG" 2>&1
  else aws_s3 cp --only-show-errors "$(url "$1")" "$2" </dev/null >>"$LOG" 2>&1; fi
}
# Every object under a folder, one "<key relative to that folder><TAB><bytes>"
# per line.
list() { # <folder key>
  local dir="${1%/}"
  if [ "$TOOL" = rclone ]; then
    rclone lsf -R --files-only --format ps --separator $'\t' "$(url "$dir")" </dev/null 2>>"$LOG"
  else
    local base="${PREFIX:+$PREFIX/}$dir/"
    aws_s3 ls --recursive "$(url "$dir")/" </dev/null 2>>"$LOG" \
      | awk -v base="$base" '{ size=$3; $1=$2=$3=""; sub(/^ +/, ""); if (index($0, base) == 1) print substr($0, length(base) + 1) "\t" size }'
  fi
}
delete_key() { # <key>
  if [ "$DRY_RUN" = 1 ]; then echo "would delete $1" >&2; return 0; fi
  if [ "$TOOL" = rclone ]; then rclone deletefile "$(url "$1")" </dev/null >>"$LOG" 2>&1
  else aws_s3 rm --only-show-errors "$(url "$1")" </dev/null >>"$LOG" 2>&1; fi
}
remote_size() { # <key> — the destination's own answer, not the exit status's
  local dir name
  dir=$(dirname "$1"); name=$(basename "$1")
  list "$dir" | awk -F'\t' -v n="$name" '$1 == n { print $2; exit }'
}

# ── encryption ──────────────────────────────────────────────────────────────
# The passphrase reaches gpg on file descriptor 3, never on a command line
# where ps or /proc would show it.
passphrase() {
  if [ -n "$PASSPHRASE_FILE" ]; then cat "$PASSPHRASE_FILE"; else printf '%s' "$MAHAD_OFFSITE_PASSPHRASE"; fi
}
gpg_run() { gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 "$@" 3< <(passphrase) </dev/null 2>>"$LOG"; }
encrypt() { gpg_run --symmetric --cipher-algo AES256 -o "$2" "$1"; }   # <in> <out|->
decrypt() { gpg_run --decrypt -o "$2" "$1"; }                          # <in> <out>

# Encrypt, prove the copy opens, upload, and ask the bucket for its size.
ship_file() { # <local plaintext> <key>
  local enc="$TMP/$(basename "$2")"
  encrypt "$1" "$enc" || { echo "encrypting $(basename "$1") failed"; return 1; }
  [ -s "$enc" ] || { echo "the encrypted copy of $(basename "$1") is empty"; return 1; }
  # Symmetric means this box can decrypt too, so a copy is proven to open
  # before it is trusted.
  gpg_run --decrypt "$enc" | cmp -s - "$1" || { echo "the encrypted copy of $(basename "$1") does not decrypt back to it"; return 1; }
  put_file "$enc" "$2" || { echo "uploading $2 failed"; return 1; }
  if [ "$DRY_RUN" = 0 ]; then
    local want got
    want=$(stat -c%s "$enc"); got=$(remote_size "$2")
    [ "${got:-0}" = "$want" ] || { echo "the bucket reports ${got:-no} bytes for $2, the encrypted copy is $want"; return 1; }
  fi
  rm -f "$enc"
}

lock() { # one run of a job at a time; an overlapping one is skipped, not queued
  command -v flock >/dev/null 2>&1 || return 0
  exec 9>"$STATE_DIR/$CMD.lock"
  flock -n 9 || { log "another $CMD is still running; skipped"; exit 0; }
}

# ── commands ────────────────────────────────────────────────────────────────
cmd_test() {
  require_settings
  private_tmp
  local key="_check/$(hostname 2>/dev/null || echo server)-$(date +%Y%m%d_%H%M%S).txt.gpg"
  echo "tool     : $TOOL"
  echo "bucket   : $(url '')"
  echo "check    : $key"
  echo "mahad off-site check $(date -Iseconds)" > "$TMP/check.txt"
  if [ "$DRY_RUN" = 1 ]; then echo "dry run: the settings are complete; nothing was uploaded"; return 0; fi
  ship_file "$TMP/check.txt" "$key" > "$TMP/why" || die "upload: $(cat "$TMP/why")"
  get_file "$key" "$TMP/back.gpg" || die "the test object could not be downloaded again (does the key allow reading?)"
  decrypt "$TMP/back.gpg" "$TMP/back.txt" && cmp -s "$TMP/check.txt" "$TMP/back.txt" \
    || die "the test object came back different"
  delete_key "$key" || echo "note: the test object could not be deleted — fine for a key without delete rights; a lifecycle rule must then do the retention"
  say "test ok: wrote, listed, read back, decrypted and deleted $key"
  record ok "test"
}

cmd_push_dump() {
  local file="${1:-}"
  [ -f "$file" ] || die "no such dump: ${file:-<none given>}"
  require_settings
  private_tmp
  local key="db/$(basename "$file").gpg"
  ship_file "$file" "$key" > "$TMP/why" || die "$(cat "$TMP/why")"
  say "off-site ok: $(url "$key")"
  record ok "$key"
}

# Point-in-time recovery: every binary log MariaDB has closed goes off-site
# within 15 minutes. The active one is still being written and is never sent;
# a flush closes it first when it has new events, so the window a lost server
# takes with it is one cron interval.
mysql_q() { mysql -u root -N -B -e "$1" 2>>"$LOG"; }
cmd_ship_binlogs() {
  lock
  local status active pos
  status=$(mysql_q "SHOW MASTER STATUS") || die "cannot ask MariaDB for its binary log status"
  if [ -z "$status" ]; then
    # Binary logging is off (deploy/mariadb/60-mahad-binlog.cnf turns it on).
    record off "binary logging is off in MariaDB"
    return 0
  fi
  require_settings
  private_tmp
  active=$(echo "$status" | awk 'NR==1 {print $1}'); pos=$(echo "$status" | awk 'NR==1 {print $2}')
  if [ "${MAHAD_OFFSITE_BINLOG_FLUSH:-1}" = 1 ] && [ "$DRY_RUN" = 0 ] \
     && [ "$active $pos" != "$(cat "$STATE_DIR/binlog-after-flush" 2>/dev/null)" ]; then
    mysql_q "FLUSH BINARY LOGS" >/dev/null || die "FLUSH BINARY LOGS failed"
    status=$(mysql_q "SHOW MASTER STATUS")
    active=$(echo "$status" | awk 'NR==1 {print $1}'); pos=$(echo "$status" | awk 'NR==1 {print $2}')
    # Unchanged at the next run means nothing was written: no empty log is
    # closed and shipped every 15 minutes.
    echo "$active $pos" > "$STATE_DIR/binlog-after-flush"
  fi
  local dir
  dir=$(mysql_q "SELECT @@log_bin_basename")
  dir=$(dirname "${dir:-/var/log/mysql/mariadb-bin}")
  local shipped="$STATE_DIR/binlogs.shipped" sent=0 name file mtime day
  touch "$shipped"
  while read -r name _; do
    [ -n "$name" ] && [ "$name" != "$active" ] || continue
    file="$dir/$name"
    [ -f "$file" ] || continue
    mtime=$(stat -c %Y "$file")
    # Name and close time: a rebuilt server's mariadb-bin.000001 is a new log.
    grep -qxF "$name $mtime" "$shipped" && continue
    day=$(date -d "@$mtime" +%Y-%m-%d)
    ship_file "$file" "binlog/$day/$name.gpg" > "$TMP/why" || die "$(cat "$TMP/why")"
    [ "$DRY_RUN" = 0 ] && echo "$name $mtime" >> "$shipped"
    sent=$((sent + 1))
  done < <(mysql_q "SHOW BINARY LOGS")
  [ "$sent" -gt 0 ] && log "shipped $sent binary log(s); active $active"
  record ok "shipped $sent, active $active"
}

# The folders uploads live in: <api>/uploads plus any of the API's own
# *_DIR settings that point outside it.
upload_dirs() {
  if [ -n "${MAHAD_OFFSITE_UPLOAD_DIRS:-}" ]; then printf '%s\n' $MAHAD_OFFSITE_UPLOAD_DIRS; return; fi
  echo "$API_DIR/uploads"
  local var value
  for var in VIDEO_UPLOAD_DIR BRAND_ASSET_DIR MEDIA_IMAGE_DIR; do
    value=$(grep -m1 "^$var=" "$API_DIR/.env" 2>/dev/null | cut -d= -f2- | tr -d '\r"'"'")
    case "$value" in ""|"$API_DIR/uploads"|"$API_DIR/uploads/"*) ;; *) echo "$value" ;; esac
  done
}

# Incremental by size and modification time against a manifest of what went up,
# one encrypted object per file, streamed so a 2 GB lecture never needs 2 GB of
# free disk. Copy, never sync: a file deleted here stays off-site, so a mistaken
# rm -rf (or ransomware) cannot reach the copies.
cmd_sync_uploads() {
  lock
  require_settings
  private_tmp
  local manifest="$STATE_DIR/uploads.manifest" sent=0 failed=0 dir rel size mtime key
  touch "$manifest"
  local next="$TMP/manifest.next"
  cp "$manifest" "$next"
  while read -r dir; do
    [ -d "$dir" ] || continue
    while IFS=$'\t' read -r rel size mtime; do
      key="uploads${dir%/}/$rel.gpg"
      grep -qxF "$key"$'\t'"$size"$'\t'"$mtime" "$manifest" && continue
      if encrypt "$dir/$rel" - | put_stream "$key"; then
        [ "$DRY_RUN" = 0 ] && printf '%s\t%s\t%s\n' "$key" "$size" "$mtime" >> "$next"
        sent=$((sent + 1))
      else
        failed=$((failed + 1)); log "could not upload $dir/$rel"
      fi
    done < <(find "$dir" -type f ! -path '*/.tmp/*' ! -name '*.partial' -printf '%P\t%s\t%T@\n' 2>/dev/null | LC_ALL=C sort)
  done < <(upload_dirs)
  # A later entry for a key wins, so the manifest keeps one line per file.
  [ "$DRY_RUN" = 0 ] && awk -F'\t' '{ last[$1] = $0; order[NR] = $1 } END { for (i = 1; i <= NR; i++) if (last[order[i]] != "") { print last[order[i]]; last[order[i]] = "" } }' "$next" > "$manifest"
  [ "$failed" -eq 0 ] || die "$failed upload(s) failed, $sent sent (see $LOG)"
  say "uploads ok: $sent new or changed file(s) sent"
  record ok "$sent sent"
}

# Off-site retention, decided from the timestamps in the names (never from
# upload times, which a re-upload would reset): every dump of the last
# KEEP_HOURLY_DAYS days, the first of each day for KEEP_DAILY_DAYS, the first
# of each month for KEEP_MONTHLY months. Binary logs for KEEP_BINLOG_DAYS — a
# binlog is only useful on top of a dump that is still kept.
# MAHAD_OFFSITE_PRUNE=0 when a key without delete rights is used and the
# bucket's lifecycle rules do this instead.
cmd_prune() {
  [ "${MAHAD_OFFSITE_PRUNE:-1}" = 1 ] || { record off "MAHAD_OFFSITE_PRUNE=0 (lifecycle rules)"; return 0; }
  lock
  require_settings
  local hourly daily monthly binlog n=0 key
  hourly=$(date -d "-$KEEP_HOURLY_DAYS days" +%Y%m%d)
  daily=$(date -d "-$KEEP_DAILY_DAYS days" +%Y%m%d)
  monthly=$(date -d "$(date +%Y-%m-01) -$((KEEP_MONTHLY - 1)) months" +%Y%m)
  binlog=$(date -d "-$KEEP_BINLOG_DAYS days" +%Y-%m-%d)
  local listing
  listing=$(list db) || die "cannot list $(url db)"
  while read -r key; do
    [ -n "$key" ] || continue
    delete_key "db/$key" || die "could not delete db/$key"
    n=$((n + 1))
  done < <(printf '%s\n' "$listing" | cut -f1 | grep -E '_[0-9]{8}_[0-9]{6}\.sql\.gz\.gpg$' | LC_ALL=C sort \
    | awk -v h="$hourly" -v d="$daily" -v m="$monthly" '{
        match($0, /_[0-9]{8}_[0-9]{6}\.sql/); db = substr($0, 1, RSTART - 1)
        day = substr($0, RSTART + 1, 8); month = substr(day, 1, 6)
        first_day = !((db, day) in seen_day); seen_day[db, day] = 1
        first_month = !((db, month) in seen_month); seen_month[db, month] = 1
        if (day >= h) next
        if (day >= d && first_day) next
        if (month >= m && first_month) next
        print }' | LC_ALL=C sort)
  listing=$(list binlog) || die "cannot list $(url binlog)"
  while read -r key; do
    [ -n "$key" ] || continue
    delete_key "binlog/$key" || die "could not delete binlog/$key"
    n=$((n + 1))
  done < <(printf '%s\n' "$listing" | cut -f1 | awk -F/ -v b="$binlog" '$1 ~ /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/ && $1 < b')
  say "prune ok: $n object(s) past retention removed"
  record ok "$n removed"
}

# The newest dump off-site, by the timestamp in its name.
newest_dump() { # [not after YYYYMMDD_HHMMSS]
  list db | cut -f1 | grep -E '_[0-9]{8}_[0-9]{6}\.sql\.gz\.gpg$' \
    | awk -v limit="${1:-}" '{ match($0, /_[0-9]{8}_[0-9]{6}\.sql/); s = substr($0, RSTART + 1, 15); if (limit == "" || s <= limit) print s "\t" $0 }' \
    | LC_ALL=C sort | tail -1 | cut -f2
}

fetch_dump() { # <name.sql.gz.gpg> <dir> — prints the decrypted path
  local name="$1" out="$2/${1%.gpg}"
  get_file "db/$name" "$TMP/$name" || { echo "downloading db/$name failed"; return 1; }
  decrypt "$TMP/$name" "$out" || { echo "db/$name does not decrypt (wrong passphrase?)"; return 1; }
  rm -f "$TMP/$name"
  gunzip -t "$out" 2>>"$LOG" || { echo "db/$name decrypts to a corrupt archive"; return 1; }
  echo "$out"
}

cmd_fetch_db() {
  local which="${1:-latest}" dir="${2:-}"
  [ -n "$dir" ] || { echo "usage: mahad-offsite fetch-db [NAME|latest] DIR" >&2; exit 64; }
  require_settings
  private_tmp
  mkdir -p "$dir" && chmod 700 "$dir"
  [ "$which" = latest ] && which=$(newest_dump)
  [ -n "$which" ] || die "no dump found under $(url db)"
  fetch_dump "${which%.gpg}.gpg" "$dir" > "$TMP/out" || die "$(cat "$TMP/out")"
  echo "$(cat "$TMP/out")"
}

# The monthly proof that the off-site copy — not just the local one — brings
# the business back: the newest dump is downloaded, decrypted and handed to the
# same check the weekly local rehearsal runs (npm run verify:backup-restores:
# restore into a throwaway database, compare with the live one, drop it).
cmd_rehearse() {
  if [ "$SCHEDULED" = 1 ] && [ "${MAHAD_OFFSITE_REHEARSAL:-0}" != 1 ]; then return 0; fi
  lock
  require_settings
  private_tmp
  local name restored
  name=$(newest_dump)
  [ -n "$name" ] || die "no dump found under $(url db)"
  say "rehearsal: newest off-site dump is $name"
  mkdir -p "$TMP/restore"
  restored=$(fetch_dump "$name" "$TMP/restore") || die "$restored"
  local verify="${MAHAD_OFFSITE_VERIFY_CMD:-cd $API_DIR && npm run -s verify:backup-restores}"
  if MAHAD_BACKUP_DIR="$TMP/restore" bash -c "$verify" >> "$LOG" 2>&1; then
    say "rehearsal PASS: $name downloaded, decrypted, restored into a scratch database and verified"
    record ok "$name"
  else
    die "the off-site dump $name did not pass the restore check (see $LOG)"
  fi
}

# Everything needed to rebuild the database as it was at a moment: the newest
# dump taken before it, the binary logs from that dump's position on, and the
# exact commands — written to DIR/RESTORE_COMMANDS.txt and checked by reading
# the binlogs once with mysqlbinlog. It restores nothing by itself: where to
# restore (a new database, then a rename) is a person's decision.
cmd_fetch_pitr() {
  local when="${1:-}" dir="${2:-}"
  [ -n "$when" ] && [ -n "$dir" ] || { echo "usage: mahad-offsite fetch-pitr 'YYYY-MM-DD HH:MM:SS' DIR" >&2; exit 64; }
  local stamp
  stamp=$(date -d "$when" +%Y%m%d_%H%M%S 2>/dev/null) || { echo "not a date: $when" >&2; exit 64; }
  require_settings
  private_tmp
  mkdir -p "$dir/binlogs" && chmod 700 "$dir"
  local name dump
  name=$(newest_dump "$stamp")
  [ -n "$name" ] || die "no off-site dump was taken before $when"
  dump=$(fetch_dump "$name" "$dir") || die "$dump"
  # Written by mysqldump --master-data=2 when binary logging was on.
  local start_file start_pos
  start_file=$(gunzip -c "$dump" | head -n 60 | sed -n "s/.*CHANGE MASTER TO MASTER_LOG_FILE='\([^']*\)'.*/\1/p" | head -1)
  start_pos=$(gunzip -c "$dump" | head -n 60 | sed -n "s/.*MASTER_LOG_POS=\([0-9]*\).*/\1/p" | head -1)
  [ -n "$start_file" ] && [ -n "$start_pos" ] \
    || die "$name records no binary log position (binary logging was off when it was taken); restore it alone"
  local dump_day files=() key day base
  dump_day=$(echo "$name" | sed -E 's/.*_([0-9]{4})([0-9]{2})([0-9]{2})_[0-9]{6}\.sql\.gz\.gpg$/\1-\2-\3/')
  # A binlog's folder is the day it was closed, so the one holding the dump's
  # position is in the dump's day or later.
  while read -r key; do
    day=${key%%/*}; base=$(basename "$key" .gpg)
    [[ "$day" < "$dump_day" ]] && continue
    [[ "$base" < "$start_file" ]] && continue
    get_file "binlog/$key" "$TMP/b.gpg" && decrypt "$TMP/b.gpg" "$dir/binlogs/$base" || die "binlog/$key could not be fetched or decrypted"
    files+=("$dir/binlogs/$base")
  done < <(list binlog | cut -f1 | awk -F/ '{ print $2 "\t" $0 }' | LC_ALL=C sort | cut -f2)
  [ "${#files[@]}" -gt 0 ] && [ "$(basename "${files[0]}")" = "$start_file" ] \
    || die "the binary log $start_file, where $name ends, is not off-site — the restore can only reach the dump itself"
  mysqlbinlog --start-position="$start_pos" --stop-datetime="$when" "${files[@]}" > /dev/null 2>>"$LOG" \
    || die "mysqlbinlog could not read the downloaded binary logs"
  {
    echo "# Rebuild the database as it was at $when (server time)."
    echo "# 1. a NEW database — never straight over the live one:"
    echo "mysql -u root -e 'CREATE DATABASE mahad_pitr CHARACTER SET utf8mb4'"
    echo "zcat $dump | mysql -u root mahad_pitr"
    echo "# 2. every change after the dump, up to the moment:"
    echo "mysqlbinlog --start-position=$start_pos --stop-datetime='$when' ${files[*]} | mysql -u root mahad_pitr"
    echo "# 3. check it (npm run verify:backup-restores compares row counts), then switch the API's DB_NAME or rename."
  } > "$dir/RESTORE_COMMANDS.txt"
  say "point-in-time set ready in $dir: $(basename "$dump") + ${#files[@]} binary log(s) from $start_file:$start_pos; commands in $dir/RESTORE_COMMANDS.txt"
}

# Every uploaded file back, decrypted, under DIR at its original path
# (DIR/var/www/mahad-api/uploads/videos/...), to be moved into place by a person.
cmd_fetch_uploads() {
  local dir="${1:-}"
  [ -n "$dir" ] || { echo "usage: mahad-offsite fetch-uploads DIR" >&2; exit 64; }
  require_settings
  private_tmp
  local key n=0 out
  while IFS=$'\t' read -r key _; do
    [ -n "$key" ] || continue
    out="$dir/${key%.gpg}"
    mkdir -p "$(dirname "$out")"
    get_file "uploads/$key" "$TMP/u.gpg" && decrypt "$TMP/u.gpg" "$out" || die "uploads/$key could not be fetched or decrypted"
    n=$((n + 1))
  done < <(list uploads)
  say "$n uploaded file(s) restored under $dir"
}

cmd_status() {
  echo "settings : $ENV_FILE"
  local job
  for job in push-dump ship-binlogs sync-uploads prune rehearse test; do
    printf '%-13s: %s\n' "$job" "$(cat "$STATE_DIR/last-$job" 2>/dev/null || echo 'never run')"
  done
}

case "$CMD" in
  test)         cmd_test ;;
  push-dump)    cmd_push_dump "$@" ;;
  ship-binlogs) cmd_ship_binlogs ;;
  sync-uploads) cmd_sync_uploads ;;
  prune)        cmd_prune ;;
  rehearse)     cmd_rehearse ;;
  fetch-db)     cmd_fetch_db "$@" ;;
  fetch-pitr)   cmd_fetch_pitr "$@" ;;
  fetch-uploads) cmd_fetch_uploads "$@" ;;
  status)       cmd_status ;;
  *) echo "unknown command: $CMD (mahad-offsite help)" >&2; exit 64 ;;
esac
