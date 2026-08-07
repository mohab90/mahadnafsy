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

# Retention. -mtime is only applied once the backup above has been verified, so
# a run of failures can never delete the last good copy.
find "$DIR" -name "${DB}_*.sql.gz" -mtime "+${KEEP_DAYS}" -delete
