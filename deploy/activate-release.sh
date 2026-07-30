#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: activate-release.sh <artifact.tgz> <artifact.sha256> <release-id>" >&2
  exit 64
fi

ARTIFACT="$(realpath "$1")"
CHECKSUM="$(realpath "$2")"
RELEASE_ID="$3"
RELEASE_ROOT="/opt/mahad/releases"
CURRENT_LINK="/opt/mahad/current"
ENV_FILE="/etc/mahad/api.env"

[[ "$RELEASE_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{5,79}$ ]] || {
  echo "invalid release id" >&2
  exit 64
}
[[ -f "$ARTIFACT" && -f "$CHECKSUM" && -f "$ENV_FILE" ]] || {
  echo "artifact, checksum, or production environment file is missing" >&2
  exit 66
}
[[ "$(dirname "$ARTIFACT")" == "$(dirname "$CHECKSUM")" ]] || {
  echo "artifact and checksum must be staged in the same directory" >&2
  exit 64
}

cd "$(dirname "$ARTIFACT")"
EXPECTED_SHA="$(awk 'NR == 1 { print $1 }' "$CHECKSUM")"
ACTUAL_SHA="$(sha256sum -- "$ARTIFACT" | awk '{ print $1 }')"
[[ "$EXPECTED_SHA" =~ ^[a-fA-F0-9]{64}$ && "${ACTUAL_SHA,,}" == "${EXPECTED_SHA,,}" ]] || {
  echo "artifact checksum mismatch" >&2
  exit 65
}

ARCHIVE_LIST="$(tar -tzf "$ARTIFACT")"
if grep -Eq '(^/|(^|/)\.\.(/|$))' <<<"$ARCHIVE_LIST"; then
  echo "artifact contains an unsafe path" >&2
  exit 65
fi
if grep -Ev '^mahad-api(/|$)' <<<"$ARCHIVE_LIST" | grep -q .; then
  echo "API artifact must contain only the mahad-api prefix" >&2
  exit 65
fi
if tar -tvzf "$ARTIFACT" | awk 'substr($1,1,1) ~ /[lh]/ { found=1 } END { exit !found }'; then
  echo "artifact links are not allowed" >&2
  exit 65
fi

TARGET="$RELEASE_ROOT/$RELEASE_ID"
[[ ! -e "$TARGET" ]] || {
  echo "release already exists: $TARGET" >&2
  exit 73
}

PREVIOUS=""
if [[ -L "$CURRENT_LINK" ]]; then
  PREVIOUS="$(readlink -f "$CURRENT_LINK")"
  [[ "$PREVIOUS" == "$RELEASE_ROOT/"* ]] || {
    echo "current release link points outside $RELEASE_ROOT" >&2
    exit 78
  }
fi

STAGING="$RELEASE_ROOT/.${RELEASE_ID}.staging.$$"
mkdir -p "$STAGING"
trap 'rm -rf -- "$STAGING"' EXIT
tar -xzf "$ARTIFACT" --no-same-owner --no-same-permissions --strip-components=1 -C "$STAGING"

cd "$STAGING"
npm ci --omit=dev

run_release_job() {
  local job="$1"
  local unit_job="${job//:/-}"
  local unit_tag
  unit_tag="$(printf '%s' "$RELEASE_ID" | sha256sum | cut -c1-16)"
  systemd-run --wait --pipe --collect --quiet \
    --unit="mahad-release-${unit_tag}-${unit_job}" \
    --property=Type=oneshot \
    --property="EnvironmentFile=$ENV_FILE" \
    --uid=mahad \
    --gid=mahad \
    --working-directory="$STAGING" \
    --setenv=NODE_ENV=production \
    --setenv=RUN_MIGRATIONS_ON_STARTUP=false \
    --setenv="APP_RELEASE=$RELEASE_ID" \
    /usr/bin/npm run "$job"
}

# Never source a systemd EnvironmentFile as shell code. Each release job gets
# the exact production environment from an isolated transient service.
run_release_job migrate
run_release_job migrate:verify
run_release_job reconcile
run_release_job readiness:production:live

mv -- "$STAGING" "$TARGET"
trap - EXIT
ln -sfn "$TARGET" "${CURRENT_LINK}.next"
mv -Tf "${CURRENT_LINK}.next" "$CURRENT_LINK"
systemctl restart mahad-api.service

for _ in {1..30}; do
  curl --fail --silent --max-time 3 http://127.0.0.1:3001/api/health >/dev/null && exit 0
  sleep 1
done

echo "release activated but readiness health did not recover" >&2
if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
  ln -sfn "$PREVIOUS" "${CURRENT_LINK}.rollback"
  mv -Tf "${CURRENT_LINK}.rollback" "$CURRENT_LINK"
  systemctl restart mahad-api.service
  echo "rolled back to $PREVIOUS" >&2
fi
exit 1
