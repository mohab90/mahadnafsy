#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "usage: activate-static-release.sh <admin|client> <artifact.tgz> <artifact.sha256> <release-id>" >&2
  exit 64
fi

COMPONENT="$1"
[[ "$COMPONENT" == "admin" || "$COMPONENT" == "client" ]] || {
  echo "component must be admin or client" >&2
  exit 64
}

ARTIFACT="$(realpath "$2")"
CHECKSUM="$(realpath "$3")"
RELEASE_ID="$4"
STATIC_ROOT="/opt/mahad/static"
RELEASE_ROOT="$STATIC_ROOT/releases"
CURRENT_LINK="$STATIC_ROOT/$COMPONENT"

[[ "$RELEASE_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{5,79}$ ]] || {
  echo "invalid release id" >&2
  exit 64
}
[[ -f "$ARTIFACT" && -f "$CHECKSUM" ]] || {
  echo "artifact or checksum is missing" >&2
  exit 66
}
[[ "$(dirname "$ARTIFACT")" == "$(dirname "$CHECKSUM")" ]] || {
  echo "artifact and checksum must be staged in the same directory" >&2
  exit 64
}

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
if tar -tvzf "$ARTIFACT" | awk 'substr($1,1,1) ~ /[lh]/ { found=1 } END { exit !found }'; then
  echo "artifact links are not allowed" >&2
  exit 65
fi

TARGET="$RELEASE_ROOT/$RELEASE_ID/$COMPONENT"
[[ ! -e "$TARGET" ]] || {
  echo "static release already exists: $TARGET" >&2
  exit 73
}

PREVIOUS=""
if [[ -L "$CURRENT_LINK" ]]; then
  PREVIOUS="$(readlink -f "$CURRENT_LINK")"
  [[ "$PREVIOUS" == "$RELEASE_ROOT/"*"/$COMPONENT" ]] || {
    echo "current static link points outside the release root" >&2
    exit 78
  }
fi

STAGING="$RELEASE_ROOT/.${RELEASE_ID}-${COMPONENT}.staging.$$"
mkdir -p "$(dirname "$TARGET")" "$STAGING"
trap 'rm -rf -- "$STAGING"' EXIT
tar -xzf "$ARTIFACT" --no-same-owner --no-same-permissions -C "$STAGING"
[[ -f "$STAGING/index.html" ]] || {
  echo "static artifact has no index.html" >&2
  exit 65
}

mv -- "$STAGING" "$TARGET"
trap - EXIT
ln -sfn "$TARGET" "${CURRENT_LINK}.next"
mv -Tf "${CURRENT_LINK}.next" "$CURRENT_LINK"

if ! nginx -t; then
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
    ln -sfn "$PREVIOUS" "${CURRENT_LINK}.rollback"
    mv -Tf "${CURRENT_LINK}.rollback" "$CURRENT_LINK"
  fi
  exit 1
fi
systemctl reload nginx
