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

# Settings for a run started by cron, which has no login environment. Read only
# when root owns the file and nobody else can write to it — it is sourced by a
# root shell, so a writable one would be a way in.
ENV_FILE="${MAHAD_BACKUP_ENV_FILE:-/etc/mahad/backup.env}"
if [ -f "$ENV_FILE" ]; then
  if [ "$(stat -c '%u' "$ENV_FILE")" = "0" ] && [ -z "$(find "$ENV_FILE" -perm /022)" ]; then
    set -a; . "$ENV_FILE"; set +a
  else
    echo "ALERT mahad-db-backup: ignoring $ENV_FILE — it must be owned by root and not group/world-writable" >&2
  fi
fi

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
# a run of failures can never delete the last good copy. It runs before the
# off-site step because that step can now end the run, and a month of failed
# uploads must not also fill the disk with dumps nobody prunes.
find "$DIR" -name "${DB}_*.sql.gz" -mtime "+${KEEP_DAYS}" -delete

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
# So the copy has to leave the machine, and since 11 Oct 2026 a run that could
# not send it there is a failed run. It used to be a WARNING line in a log
# nobody opened, behind an opt-in (MAHAD_BACKUP_REMOTE_REQUIRED=1) nobody set —
# so the box had only ever kept its backups on itself. The local dump above is
# still written and kept either way; the exit status and the ALERT line are what
# change, so cron mails it, syslog has it, and the deploy (release-all.sh, step
# 6) prints it in red.
#
# The copy is encrypted before it leaves: the dump holds every client's phone
# number, every payment and every therapist's notes, and an rclone bucket is one
# leaked token away from being public. Nothing is ever shipped in clear.
#
# Settings — in the environment, or in $MAHAD_BACKUP_ENV_FILE
# (/etc/mahad/backup.env by default, root-owned, not group/world-writable):
#
#   MAHAD_BACKUP_REMOTE            rclone destination, "remote:bucket/path". Required.
#   MAHAD_BACKUP_AGE_RECIPIENTS    file of age public keys (age1…). Preferred: the
#                                  server can encrypt but never decrypt, so a
#                                  compromised box cannot read the off-site copies.
#   MAHAD_BACKUP_GPG_PASSPHRASE_FILE
#                                  file holding a gpg symmetric passphrase (chmod 400).
#   MAHAD_BACKUP_GPG_PASSPHRASE    the same passphrase from the environment instead.
#                                  One of the three key settings is required.
#   MAHAD_BACKUP_REMOTE_KEEP_DAYS  how long encrypted copies stay at the destination (default 30). Older ones are deleted ONLY after
#                                  today's copy is confirmed there, so a run of failed uploads never empties the destination — and a
#                                  Google Drive (15 GB free) does not fill up.
#   MAHAD_BACKUP_ALLOW_LOCAL_ONLY  =1 for a developer machine or a throwaway VM:
#                                  no off-site copy, a WARNING instead of a failure.
#                                  Never set it on the production server.
#
# Exit status: 0 all good; 1 the local dump itself failed; 3 the local dump is
# good but the off-site copy is missing or failed (release-all.sh tells the two
# apart, because only the first makes a deploy unsafe).
REMOTE="${MAHAD_BACKUP_REMOTE:-}"
ALLOW_LOCAL_ONLY="${MAHAD_BACKUP_ALLOW_LOCAL_ONLY:-0}"
AGE_RECIPIENTS="${MAHAD_BACKUP_AGE_RECIPIENTS:-}"
GPG_PASSPHRASE_FILE="${MAHAD_BACKUP_GPG_PASSPHRASE_FILE:-}"
ENCRYPTED=""

alert() {
  # One line, three places: the log, stderr (cron mails it), syslog.
  log "ALERT $*"
  echo "ALERT mahad-db-backup: $*" >&2
  command -v logger >/dev/null 2>&1 && logger -p user.err -t mahad-db-backup "ALERT $*"
  return 0
}

offsite_fail() {
  [ -n "$ENCRYPTED" ] && rm -f "$ENCRYPTED"
  if [ "$ALLOW_LOCAL_ONLY" = "1" ]; then
    log "WARNING off-site copy skipped: $* (MAHAD_BACKUP_ALLOW_LOCAL_ONLY=1 — a development setting)"
    exit 0
  fi
  alert "OFF-SITE BACKUP FAILED: $* — the only copy of ${DB} is on this machine (local dump ok: $OUT)"
  exit 3
}

encrypt_dump() {
  if [ -n "$AGE_RECIPIENTS" ]; then
    command -v age >/dev/null 2>&1 || return 10
    [ -s "$AGE_RECIPIENTS" ] || return 11
    ENCRYPTED="$OUT.age"
    age -R "$AGE_RECIPIENTS" -o "$ENCRYPTED" "$OUT" 2>>"$LOG" || return 12
  elif [ -n "$GPG_PASSPHRASE_FILE" ] || [ -n "${MAHAD_BACKUP_GPG_PASSPHRASE:-}" ]; then
    command -v gpg >/dev/null 2>&1 || return 10
    if [ -n "$GPG_PASSPHRASE_FILE" ]; then [ -s "$GPG_PASSPHRASE_FILE" ] || return 11; fi
    ENCRYPTED="$OUT.gpg"
    # The passphrase goes in on stdin (fd 0), never on a command line where ps
    # or /proc would show it; the dump is the file argument.
    gpg_run() {
      gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 0 "$@" 2>>"$LOG"
    }
    passphrase() {
      if [ -n "$GPG_PASSPHRASE_FILE" ]; then cat "$GPG_PASSPHRASE_FILE"; else printf '%s' "$MAHAD_BACKUP_GPG_PASSPHRASE"; fi
    }
    passphrase | gpg_run --symmetric --cipher-algo AES256 -o "$ENCRYPTED" "$OUT" || return 12
    # Symmetric means this box can also decrypt, so it proves the copy opens
    # before it is trusted — the same rule as the three local checks above.
    { passphrase; } | gpg_run --decrypt "$ENCRYPTED" | gunzip -t 2>>"$LOG" || return 13
  else
    return 14
  fi
  [ -s "$ENCRYPTED" ] || return 12
}

if [ -z "$REMOTE" ]; then
  offsite_fail "MAHAD_BACKUP_REMOTE is not set"
elif ! command -v rclone >/dev/null 2>&1; then
  offsite_fail "rclone is not installed"
fi
encrypt_dump
case $? in
  0) ;;
  10) offsite_fail "the encryption tool (age or gpg) is not installed" ;;
  11) offsite_fail "the encryption key file is missing or empty" ;;
  12) offsite_fail "encrypting the dump failed" ;;
  13) offsite_fail "the encrypted copy does not decrypt back to a valid archive" ;;
  *)  offsite_fail "no encryption key is configured (MAHAD_BACKUP_AGE_RECIPIENTS or MAHAD_BACKUP_GPG_PASSPHRASE_FILE) — dumps are never shipped in clear" ;;
esac

ENC_SIZE=$(stat -c%s "$ENCRYPTED")
if ! rclone copy --no-traverse "$ENCRYPTED" "$REMOTE" >>"$LOG" 2>&1; then
  offsite_fail "rclone copy to $REMOTE returned non-zero"
fi
# Confirmed by asking the destination, not by trusting the exit status —
# the same reasoning as the three local checks above.
REMOTE_SIZE=$(rclone size --json "$REMOTE/$(basename "$ENCRYPTED")" 2>>"$LOG" | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')
if [ "${REMOTE_SIZE:-0}" -ne "$ENC_SIZE" ]; then
  offsite_fail "destination reports ${REMOTE_SIZE:-0} bytes, the encrypted copy is ${ENC_SIZE}"
fi
log "off-site ok: $REMOTE/$(basename "$ENCRYPTED") (${REMOTE_SIZE} bytes, encrypted)"
# Retention at the destination, after — never before — the new copy is proven there. Only this job's own encrypted files are touched.
REMOTE_KEEP_DAYS="${MAHAD_BACKUP_REMOTE_KEEP_DAYS:-30}"
if [ "${REMOTE_KEEP_DAYS:-0}" -ge 7 ] 2>/dev/null; then
  if rclone delete "$REMOTE" --drive-use-trash=false --min-age "${REMOTE_KEEP_DAYS}d" --include "${DB}_*.sql.gz.age" --include "${DB}_*.sql.gz.gpg" >>"$LOG" 2>&1; then
    log "off-site retention: copies older than ${REMOTE_KEEP_DAYS} days removed from $REMOTE"
  else
    log "WARNING off-site retention failed (the new copy is safe): the destination may fill up"
  fi
fi
# The local plaintext dump stays for fast restores; the encrypted twin was
# only ever the vehicle.
rm -f "$ENCRYPTED"
