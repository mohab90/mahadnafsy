#!/usr/bin/env bash
# Ship a prepared release to the server and activate all three components.
#
# The repository documents what to run on the server (deploy/README_AR.md) but
# nothing carried the artifacts there, so the staging + activation steps were
# retyped by hand every time — which is where a wrong release id or a mismatched
# checksum slips in.
#
#   ./deploy/push-release.sh <host> [release-id]
#
# The release id defaults to the newest manifest in artifacts/releases.
# Host may also come from MAHAD_DEPLOY_HOST, the SSH user from MAHAD_DEPLOY_USER
# (default: mahad — activation uses sudo; do not log in as root).
#
# Authentication is your SSH key, via ssh-agent or MAHAD_DEPLOY_KEY. BatchMode is
# forced on, so ssh fails rather than falling back to an interactive password
# prompt: no password is ever typed, stored, or passed through this script.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACT_DIR="$ROOT/artifacts/releases"
REMOTE_STAGING="${MAHAD_DEPLOY_STAGING:-/staging}"

HOST="${1:-${MAHAD_DEPLOY_HOST:-}}"
RELEASE="${2:-}"
USER_NAME="${MAHAD_DEPLOY_USER:-mahad}"

if [[ -z "$HOST" ]]; then
  echo "usage: push-release.sh <host> [release-id]   (or set MAHAD_DEPLOY_HOST)" >&2
  exit 64
fi

SSH_OPTS=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new)
[[ -n "${MAHAD_DEPLOY_KEY:-}" ]] && SSH_OPTS+=(-i "$MAHAD_DEPLOY_KEY")
TARGET="$USER_NAME@$HOST"

# ── Resolve the release ──────────────────────────────────────────────────────
if [[ -z "$RELEASE" ]]; then
  RELEASE="$(ls -t "$ARTIFACT_DIR"/*.json 2>/dev/null | head -1 | xargs -r basename | sed 's/\.json$//')"
  [[ -n "$RELEASE" ]] || { echo "no manifest in $ARTIFACT_DIR — run: npm run release:prepare" >&2; exit 66; }
fi
MANIFEST="$ARTIFACT_DIR/$RELEASE.json"
[[ -f "$MANIFEST" ]] || { echo "missing manifest: $MANIFEST" >&2; exit 66; }
echo "release : $RELEASE"
echo "target  : $TARGET:$REMOTE_STAGING"

# ── Verify locally before anything leaves this machine ───────────────────────
FILES=()
for component in api admin client; do
  tgz="$ARTIFACT_DIR/$RELEASE-$component.tgz"
  sha="$tgz.sha256"
  [[ -f "$tgz" && -f "$sha" ]] || { echo "missing artifact or checksum for $component" >&2; exit 66; }
  ( cd "$ARTIFACT_DIR" && sha256sum --check --status "$(basename "$sha")" ) \
    || { echo "local checksum mismatch for $component — repackage, do not ship this" >&2; exit 65; }
  FILES+=("$tgz" "$sha")
done
FILES+=("$MANIFEST")
echo "checksums: all three components verified locally"

# ── Stage ────────────────────────────────────────────────────────────────────
ssh "${SSH_OPTS[@]}" "$TARGET" "mkdir -p '$REMOTE_STAGING'"
scp "${SSH_OPTS[@]}" "${FILES[@]}" "$TARGET:$REMOTE_STAGING/"

# Re-verify after transfer. activate-release.sh checks this too; catching it here
# means a truncated upload fails before sudo and before any service is touched.
ssh "${SSH_OPTS[@]}" "$TARGET" "cd '$REMOTE_STAGING' && sha256sum --check --status \
  '$RELEASE-api.tgz.sha256' '$RELEASE-admin.tgz.sha256' '$RELEASE-client.tgz.sha256'" \
  || { echo "checksum mismatch after transfer — nothing was activated" >&2; exit 65; }
echo "staged  : checksums re-verified on the server"

# ── Activate ─────────────────────────────────────────────────────────────────
# API first: it runs migrations, reconciliation and readiness:production:live,
# and rolls itself back if health does not return within 30s. The static bundles
# follow only if the API came up, so the frontends are never newer than the API
# they talk to.
echo "activating api…"
ssh "${SSH_OPTS[@]}" -t "$TARGET" "sudo bash /opt/mahad/current/deploy/activate-release.sh \
  '$REMOTE_STAGING/$RELEASE-api.tgz' '$REMOTE_STAGING/$RELEASE-api.tgz.sha256' '$RELEASE'"

for component in client admin; do
  echo "activating $component…"
  ssh "${SSH_OPTS[@]}" -t "$TARGET" "sudo bash /opt/mahad/current/deploy/activate-static-release.sh \
    $component '$REMOTE_STAGING/$RELEASE-$component.tgz' \
    '$REMOTE_STAGING/$RELEASE-$component.tgz.sha256' '$RELEASE'"
done

echo
echo "done: $RELEASE is live."
echo "verify: curl -fsS https://<domain>/api/health"
