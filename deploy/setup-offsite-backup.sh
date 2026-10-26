#!/bin/bash
# One-time setup of the off-site database backup, run ON THE SERVER as root.
#
#   bash setup-offsite-backup.sh <rclone-remote:bucket/path>
#   e.g. bash setup-offsite-backup.sh b2:mahad-backups/db
#
# What it does, in order, and stops at the first thing that is wrong:
#   1. installs rclone and age if they are missing (Debian / Ubuntu);
#   2. checks the rclone remote already works (`rclone config` is the one step that needs a person and an account — see deploy/README_AR.md);
#   3. makes an age key pair: the PUBLIC key stays on the server (/etc/mahad/backup-age-recipients.txt) so it can encrypt but never decrypt;
#      the PRIVATE key is written once to /root/mahad-backup-age-private-key.txt for the owner to copy somewhere safe OFFLINE and then delete;
#   4. writes /etc/mahad/backup.env (root-only) that deploy/mahad-db-backup.sh reads;
#   5. runs one backup now and shows its log, so the first off-site copy is proven rather than assumed.
#
# Without the private key the off-site copies cannot be opened — losing it makes them useless. The script says so, loudly, and does not
# overwrite a key or a settings file that already exists.
set -eu
set -o pipefail

REMOTE="${1:-}"
[ -n "$REMOTE" ] || { echo "usage: $0 <rclone-remote:bucket/path>   (e.g. b2:mahad-backups/db)" >&2; exit 2; }
case "$REMOTE" in *:*) ;; *) echo "the destination must look like remote:path — run 'rclone listremotes' to see yours" >&2; exit 2;; esac
[ "$(id -u)" = "0" ] || { echo "run as root" >&2; exit 2; }

ENV_FILE="${MAHAD_BACKUP_ENV_FILE:-/etc/mahad/backup.env}"
RECIPIENTS="/etc/mahad/backup-age-recipients.txt"
PRIVATE_KEY="/root/mahad-backup-age-private-key.txt"
SCRIPT="${MAHAD_BACKUP_SCRIPT:-/usr/local/bin/mahad-db-backup.sh}"

step() { echo; echo "== $*"; }

step "1/5 tools"
for tool in rclone age; do
  if command -v "$tool" >/dev/null 2>&1; then echo "  $tool: $(command -v "$tool")"; continue; fi
  echo "  installing $tool …"
  apt-get update -qq && apt-get install -y -qq "$tool" >/dev/null
  command -v "$tool" >/dev/null 2>&1 || { echo "  could not install $tool — install it by hand and run this again" >&2; exit 1; }
done

step "2/5 the destination answers"
REMOTE_NAME="${REMOTE%%:*}:"
if ! rclone listremotes | grep -qx "$REMOTE_NAME"; then
  echo "  rclone has no remote called $REMOTE_NAME — run 'rclone config' first (deploy/README_AR.md)" >&2
  exit 1
fi
if ! rclone mkdir "$REMOTE" 2>/dev/null || ! rclone lsd "${REMOTE%/*}" >/dev/null 2>&1 && ! rclone lsf "$REMOTE" >/dev/null 2>&1; then
  echo "  could not reach $REMOTE with this account — check 'rclone config' and the bucket name" >&2
  exit 1
fi
echo "  $REMOTE is reachable"

step "3/5 the encryption key"
mkdir -p /etc/mahad
if [ -s "$RECIPIENTS" ]; then
  echo "  keeping the existing public key in $RECIPIENTS"
else
  [ ! -e "$PRIVATE_KEY" ] || { echo "  $PRIVATE_KEY already exists but $RECIPIENTS does not — sort that out by hand, nothing was overwritten" >&2; exit 1; }
  ( umask 077; age-keygen -o "$PRIVATE_KEY" >/dev/null 2>&1 )
  age-keygen -y "$PRIVATE_KEY" > "$RECIPIENTS"
  chmod 644 "$RECIPIENTS"
  echo
  echo "  ┌──────────────────────────────────────────────────────────────────────────┐"
  echo "  │ المفتاح الخاص اتكتب في $PRIVATE_KEY"
  echo "  │ انسخه دلوقتي في مكان آمن بره السيرفر (مدير كلمات مرور / فلاشة) ثم امسحه:"
  echo "  │     shred -u $PRIVATE_KEY"
  echo "  │ من غيره النسخ الخارجية ملهاش لازمة — محدش يقدر يفتحها، ولا حتى إنت."
  echo "  └──────────────────────────────────────────────────────────────────────────┘"
fi

step "4/5 settings for the nightly job"
if [ -e "$ENV_FILE" ]; then
  echo "  $ENV_FILE already exists — left as it is. It must contain:"
  echo "    MAHAD_BACKUP_REMOTE=$REMOTE"
  echo "    MAHAD_BACKUP_AGE_RECIPIENTS=$RECIPIENTS"
else
  ( umask 077; printf 'MAHAD_BACKUP_REMOTE=%s\nMAHAD_BACKUP_AGE_RECIPIENTS=%s\n' "$REMOTE" "$RECIPIENTS" > "$ENV_FILE" )
  chown root:root "$ENV_FILE"; chmod 600 "$ENV_FILE"
  echo "  wrote $ENV_FILE (root only)"
fi

step "5/5 one backup now"
[ -x "$SCRIPT" ] || [ -f "$SCRIPT" ] || { echo "  $SCRIPT is not installed — a release installs it" >&2; exit 1; }
rc=0
bash "$SCRIPT" || rc=$?
echo
tail -5 "${MAHAD_BACKUP_LOG:-/var/log/mahad-db-backup.log}" 2>/dev/null || true
case "$rc" in
  0) echo; echo "OK — a backup was taken, encrypted, copied to $REMOTE and checked there." ;;
  3) echo; echo "The database dump is fine but the off-site copy FAILED — read the lines above." >&2; exit 3 ;;
  *) echo; echo "The backup itself failed (exit $rc) — read the lines above." >&2; exit "$rc" ;;
esac
