#!/bin/bash
# Nightly database backup, with a check that the backup is actually usable.
#
# The previous version was `mysqldump | gzip > out` followed by an unconditional
# "backup ok" log line. A pipeline's exit status is its *last* command's, so a
# failed mysqldump still exited 0, gzip still produced a valid 4 KB archive of
# nothing, and the log recorded success. Verified on the server: dumping a
# database that does not exist produced exit 0 and "backup ok". So the one
# signal saying the backups were fine could not distinguish a real backup from
# an empty one.
#
# It also ran weekly (Sunday 03:00), which on a business taking payments every
# day means losing up to seven days of orders, payments and enrolments.
set -u
set -o pipefail

DB="${MAHAD_DB:-mahadnafsy_db}"
DIR="${MAHAD_BACKUP_DIR:-/var/backups/mahad-db}"
LOG="${MAHAD_BACKUP_LOG:-/var/log/mahad-db-backup.log}"
KEEP_DAYS="${MAHAD_BACKUP_KEEP_DAYS:-21}"
# A real dump of this database is several MB. Anything under this is a failure
# that happened to produce a syntactically valid archive.
MIN_BYTES="${MAHAD_BACKUP_MIN_BYTES:-1000000}"

STAMP=$(date +%Y%m%d_%H%M%S)
OUT="$DIR/${DB}_${STAMP}.sql.gz"
mkdir -p "$DIR"

log()  { echo "$(date -Iseconds) $*" >> "$LOG"; }
fail() { log "BACKUP FAILED: $*"; rm -f "$OUT"; exit 1; }

if ! mysqldump -u root --single-transaction --routines --triggers --events "$DB" 2>>"$LOG" | gzip > "$OUT"; then
  fail "mysqldump/gzip returned non-zero"
fi

# Three independent checks — any one of them catches an empty or truncated file.
[ -f "$OUT" ] || fail "no output file"
SIZE=$(stat -c%s "$OUT")
[ "$SIZE" -ge "$MIN_BYTES" ] || fail "only ${SIZE} bytes (expected >= ${MIN_BYTES})"
gunzip -t "$OUT" 2>>"$LOG" || fail "archive is corrupt"
TABLES=$(gunzip -c "$OUT" | grep -c '^CREATE TABLE' || true)
[ "$TABLES" -ge 50 ] || fail "only ${TABLES} CREATE TABLE statements — dump is incomplete"

log "backup ok: $OUT ($(du -h "$OUT" | cut -f1), ${TABLES} tables)"

# ── Off-site copy ────────────────────────────────────────────────────────────
#
# Everything above this line protects against exactly one thing: someone
# destroying data inside the database. It protects against none of the events
# that end a business, because the backup lands on the same disk, in the same
# VM, as the database it is a copy of — and that VM also runs the API, both
# public sites, staging, and nginx. Disk failure, a suspended account, a lapsed
# card, a compromise, or one `rm -rf` takes the database and all 23 copies of it
# in the same instant.
#
# So the copy has to leave the machine. Configure MAHAD_BACKUP_REMOTE to an
# rclone destination ("remote:bucket/path") and this ships each verified dump
# there and confirms it arrived. Set MAHAD_BACKUP_REMOTE_REQUIRED=1 once that is
# working, and a failure to reach the destination becomes a failed backup rather
# than a line in a log — because a backup nobody can reach is not a backup, and
# the point of failing loudly is that somebody finds out on the night it breaks
# rather than on the morning they need it.
REMOTE="${MAHAD_BACKUP_REMOTE:-}"
REMOTE_REQUIRED="${MAHAD_BACKUP_REMOTE_REQUIRED:-0}"

offsite_fail() {
  if [ "$REMOTE_REQUIRED" = "1" ]; then fail "off-site copy: $*"; fi
  log "WARNING off-site copy skipped or failed: $* (set MAHAD_BACKUP_REMOTE_REQUIRED=1 to treat this as fatal)"
}

if [ -z "$REMOTE" ]; then
  offsite_fail "MAHAD_BACKUP_REMOTE is not set — this backup exists only on the machine it was taken from"
elif ! command -v rclone >/dev/null 2>&1; then
  offsite_fail "rclone is not installed"
elif ! rclone copy --no-traverse "$OUT" "$REMOTE" >>"$LOG" 2>&1; then
  offsite_fail "rclone copy to $REMOTE returned non-zero"
else
  # Confirmed by asking the destination, not by trusting the exit status —
  # the same reasoning as the three local checks above.
  REMOTE_SIZE=$(rclone size --json "$REMOTE/$(basename "$OUT")" 2>>"$LOG" | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')
  if [ "${REMOTE_SIZE:-0}" -ne "$SIZE" ]; then
    offsite_fail "destination reports ${REMOTE_SIZE:-0} bytes, local copy is ${SIZE}"
  else
    log "off-site ok: $REMOTE/$(basename "$OUT") (${REMOTE_SIZE} bytes)"
  fi
fi

# Retention. -mtime is only applied once the backup above has been verified, so
# a run of failures can never delete the last good copy.
find "$DIR" -name "${DB}_*.sql.gz" -mtime "+${KEEP_DAYS}" -delete
