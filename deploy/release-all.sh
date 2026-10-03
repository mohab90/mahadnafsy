#!/usr/bin/env bash
# The whole release, one command, for the /var/www + systemd server
# (deploy-release.sh is the half that runs ON the server).
#
#   MAHAD_HOST=<ip-or-host> MAHAD_KEY=~/.ssh/<your-key> bash deploy/release-all.sh
#   add --prepare-only to stop after the archives are built (nothing is uploaded)
#
# What it does, in order, and stops at the first thing that is wrong:
#   1. refuses a worktree that is not clean, and says which commit it is releasing
#   2. installs the two front ends' dependencies
#   3. release:prepare — retried, because on Windows an antivirus can lock a freshly
#      written file for a second and tar then fails with «Permission denied»
#   4. checks the archives really are THIS commit's (an old release in artifacts/
#      once got uploaded in place of a failed build)
#   5. takes a database backup on the server and refuses to go on if it failed
#   6. uploads the archives and checks their checksums on the server
#   7. runs deploy-release.sh there: staging first, production only if staging is
#      healthy, automatic rollback if production is not
#
# Authentication is your SSH key only; nothing is typed, stored or printed.
set -euo pipefail

PREPARE_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --prepare-only) PREPARE_ONLY=1 ;;
    *) echo "unknown option: $arg" >&2; exit 64 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$PREPARE_ONLY" -eq 0 ]]; then
  : "${MAHAD_HOST:?set MAHAD_HOST to the server address}"
  : "${MAHAD_KEY:?set MAHAD_KEY to your SSH private key file}"
fi
SERVER_USER="${MAHAD_USER:-root}"
SSH_OPTS=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new)
[[ -n "${MAHAD_KEY:-}" ]] && SSH_OPTS+=(-i "$MAHAD_KEY")
TARGET="$SERVER_USER@${MAHAD_HOST:-}"
BACKUP_CMD="${MAHAD_BACKUP_CMD:-bash /usr/local/bin/mahad-db-backup.sh}"
STAGING="${MAHAD_DEPLOY_STAGING:-/staging}"

say() { printf '\n== %s\n' "$*"; }

# ── 1. the commit ────────────────────────────────────────────────────────────
say "1/7 the commit"
if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
  echo "the worktree is not clean — release from a clean checkout of the commit:" >&2
  git status --short >&2
  exit 65
fi
COMMIT="$(git rev-parse HEAD)"
SHORT="${COMMIT:0:12}"
echo "releasing $(git log --oneline -1)"

# ── 2. dependencies ──────────────────────────────────────────────────────────
say "2/7 dependencies"
npm ci --prefix admin --no-audit --no-fund
npm ci --prefix client --no-audit --no-fund

# ── 3. the archives ──────────────────────────────────────────────────────────
say "3/7 building the release (admin and client are rebuilt inside this step)"
attempt=1
until npm run release:prepare; do
  if [[ "$attempt" -ge 3 ]]; then
    echo >&2
    echo "release:prepare failed 3 times." >&2
    echo "If the error says «tar: …: Cannot open: Permission denied» on Windows, an antivirus is" >&2
    echo "holding the freshly written files: exclude this folder from it, then run this again:" >&2
    echo "  Add-MpPreference -ExclusionPath '$ROOT'   (PowerShell as administrator)" >&2
    exit 70
  fi
  attempt=$((attempt + 1))
  echo "retrying (attempt $attempt of 3)…"
  sleep 5
done

# ── 4. they are this commit's ────────────────────────────────────────────────
say "4/7 checking the archives"
RELEASE="mahad-$SHORT"
for component in api admin client; do
  for file in "artifacts/releases/$RELEASE-$component.tgz" "artifacts/releases/$RELEASE-$component.tgz.sha256"; do
    [[ -s "$file" ]] || { echo "missing $file — the build did not produce this commit's archives" >&2; exit 66; }
  done
  ( cd artifacts/releases && sha256sum --check --status "$RELEASE-$component.tgz.sha256" ) \
    || { echo "checksum mismatch for $component — repackage, do not ship" >&2; exit 65; }
done
echo "release id: $RELEASE (all three archives present and their checksums match)"

if [[ "$PREPARE_ONLY" -eq 1 ]]; then
  say "done (--prepare-only): nothing was uploaded"
  exit 0
fi

# ── 5. backup ────────────────────────────────────────────────────────────────
say "5/7 database backup on the server"
ssh "${SSH_OPTS[@]}" "$TARGET" "$BACKUP_CMD" \
  || { echo "the backup failed — nothing was changed on the server" >&2; exit 75; }

# ── 6. upload and verify ─────────────────────────────────────────────────────
say "6/7 uploading to $TARGET:$STAGING"
ssh "${SSH_OPTS[@]}" "$TARGET" "mkdir -p '$STAGING'"
scp "${SSH_OPTS[@]}" \
  "artifacts/releases/$RELEASE-api.tgz" "artifacts/releases/$RELEASE-api.tgz.sha256" \
  "artifacts/releases/$RELEASE-admin.tgz" "artifacts/releases/$RELEASE-admin.tgz.sha256" \
  "artifacts/releases/$RELEASE-client.tgz" "artifacts/releases/$RELEASE-client.tgz.sha256" \
  "deploy-release.sh" "$TARGET:$STAGING/"
ssh "${SSH_OPTS[@]}" "$TARGET" "cd '$STAGING' && sha256sum --check --status \
  '$RELEASE-api.tgz.sha256' '$RELEASE-admin.tgz.sha256' '$RELEASE-client.tgz.sha256'" \
  || { echo "checksum mismatch after upload — nothing was activated" >&2; exit 65; }
echo "checksums verified on the server"

# ── 7. activate ──────────────────────────────────────────────────────────────
say "7/7 deploying (staging, then production; rolls back by itself if production is unhealthy)"
ssh "${SSH_OPTS[@]}" "$TARGET" "bash '$STAGING/deploy-release.sh' '$RELEASE'"

say "released $RELEASE"
