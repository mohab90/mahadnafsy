#!/usr/bin/env bash
# The new home page as a SIDE copy at https://<domain>/new/ — the real home page is not touched.
#
#   bash deploy/side-copy.sh --prepare-only            build artifacts/mahad-new-client.tgz, upload nothing
#   MAHAD_HOST=<ip> MAHAD_KEY=~/.ssh/<key> bash deploy/side-copy.sh      build, upload, put it in place
#
# What it does:
#   1. builds the client with base /new/ (VITE_APP_BASE) and the router under /new (VITE_ROUTER_BASENAME)
#      with the service worker off (VITE_DISABLE_SW), then strips the Google tag and the Meta Pixel and
#      sets noindex (tools/side-copy-index.mjs)
#   2. packs it with a SHA-256
#   3. uploads to /staging, checks the checksum on the server, unpacks into a NEW folder next to the
#      live one and swaps it in with a rename. It only ever creates or replaces the side folder
#      (MAHAD_SIDE_DIR, default /var/www/mahad-side/new): no other file or service is changed, and
#      nginx is not edited. The one-time nginx include is printed if it is missing
#      (deploy/nginx/mahad-new-side.conf.example).
#
# The copy talks to the real site's API: what is booked or submitted there is real.
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
SIDE_PATH="${MAHAD_SIDE_PATH:-/new}"
SIDE_DIR="${MAHAD_SIDE_DIR:-/var/www/mahad-side/new}"
STAGING="${MAHAD_DEPLOY_STAGING:-/staging}"
OUT="$ROOT/artifacts/side-copy"
say() { printf '\n== %s\n' "$*"; }

if [[ "$PREPARE_ONLY" -eq 0 ]]; then
  : "${MAHAD_HOST:?set MAHAD_HOST to the server address}"
  : "${MAHAD_KEY:?set MAHAD_KEY to your SSH private key file}"
fi
case "$SIDE_PATH" in /*[!/]) ;; *) echo "MAHAD_SIDE_PATH must look like /new" >&2; exit 64 ;; esac

say "1/3 build under $SIDE_PATH/"
[[ -d client/node_modules ]] || (cd client && npm ci --no-audit --no-fund)
rm -rf "$OUT" && mkdir -p "$OUT"
(cd client && VITE_APP_BASE="$SIDE_PATH/" VITE_ROUTER_BASENAME="$SIDE_PATH" VITE_DISABLE_SW=1 \
  npx vite build --outDir "$OUT/dist" --emptyOutDir)
node tools/side-copy-index.mjs "$OUT/dist/index.html"
[[ -f "$OUT/dist/index.html" ]] || { echo "the build has no index.html" >&2; exit 66; }
rm -f "$OUT/dist/sw.js"

say "2/3 pack"
SHORT="$(git rev-parse --short=12 HEAD 2>/dev/null || date +%s)"
ARCHIVE="$ROOT/artifacts/mahad-new-client-$SHORT.tgz"
tar -czf "$ARCHIVE" -C "$OUT/dist" .
( cd "$ROOT/artifacts" && sha256sum "$(basename "$ARCHIVE")" > "$(basename "$ARCHIVE").sha256" )
echo "built $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
if [[ "$PREPARE_ONLY" -eq 1 ]]; then
  echo "(--prepare-only: nothing uploaded)"; exit 0
fi

say "3/3 upload and put in place"
SSH_OPTS=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$MAHAD_KEY")
TARGET="${MAHAD_USER:-root}@$MAHAD_HOST"
ssh "${SSH_OPTS[@]}" "$TARGET" "mkdir -p '$STAGING'"
scp "${SSH_OPTS[@]}" "$ARCHIVE" "$ARCHIVE.sha256" "$TARGET:$STAGING/"
ssh "${SSH_OPTS[@]}" "$TARGET" "
set -euo pipefail
cd '$STAGING' && sha256sum -c '$(basename "$ARCHIVE").sha256'
NEW='$SIDE_DIR'.next
rm -rf \"\$NEW\" && mkdir -p \"\$NEW\"
tar -xzf '$STAGING/$(basename "$ARCHIVE")' -C \"\$NEW\"
test -f \"\$NEW/index.html\"
[ -d '$SIDE_DIR' ] && mv '$SIDE_DIR' '$SIDE_DIR'.prev-\$(date +%Y%m%d-%H%M%S) || true
mv \"\$NEW\" '$SIDE_DIR'
echo 'in place: $SIDE_DIR'
if grep -rqs 'mahad-new-side' /etc/nginx 2>/dev/null; then
  echo 'nginx already includes the side copy.'
else
  echo
  echo 'ONE-TIME nginx step (not done for you):'
  echo '  save deploy/nginx/mahad-new-side.conf.example as /etc/nginx/snippets/mahad-new-side.conf,'
  echo '  add   include /etc/nginx/snippets/mahad-new-side.conf;   inside the mahadnafsy.com server block,'
  echo '  then  nginx -t && systemctl reload nginx'
fi
"
echo
echo "Open: https://${MAHAD_PUBLIC_HOST:-$MAHAD_HOST}$SIDE_PATH/"
