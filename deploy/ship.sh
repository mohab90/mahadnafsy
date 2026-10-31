#!/usr/bin/env bash
# The whole ship, one command: merge the branch into main, push it, wait for CI, release (backup → staging → E2E → production), check
# production, then run the two data fixes of 31 Oct 2026 on the server.
#
#   bash deploy/ship.sh                  # asks once (type yes), then does everything
#   bash deploy/ship.sh --yes            # no question
#   bash deploy/ship.sh --dry-run        # checks and prints the plan; changes nothing
#
# What the data steps do (tools/link-site-accounts.cjs, tools/set-year-access.cjs). Each prints its report first, then applies ONLY the safe part:
#   - links site accounts to their client by the same number or the same proven email;
#   - extends enrollments that expire earlier than a year from their subscription day (never shortens one, never touches open-ended ones).
# Both write a backup file next to their output, on the server, in /root/mahad-data-fixes/<time>/.
# Anything that can take access away or is a judgement is opt-in:
#   --name-match            also link accounts whose NAME is the same as exactly one client
#   --open-ended            also give a year to enrollments with no expiry (ENDS access at once for those subscribed over a year ago)
#   --reinstate-by "<who>"  also re-open the enrollments that <who> revoked, while their year is still ahead
#   --skip-data             release only
#   --no-ci-wait            do not wait for GitHub Actions (release-all.sh still refuses a red CI when it can read it)
#   --branch <name>         the branch to ship (default: the one this script was written for)
#
# Run it from anywhere inside the repository; it works in the main checkout. Stops at the first thing that is wrong.
set -euo pipefail

BRANCH="claude/system-issues-performance-5c19bd"
ASSUME_YES=0; DRY=0; DATA=1; CI_WAIT=1; NAMES=0; OPEN=0; REINSTATE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes) ASSUME_YES=1 ;;
    --dry-run) DRY=1 ;;
    --skip-data) DATA=0 ;;
    --no-ci-wait) CI_WAIT=0 ;;
    --name-match) NAMES=1 ;;
    --open-ended) OPEN=1 ;;
    --reinstate-by) shift; REINSTATE="${1:-}"; [[ -n "$REINSTATE" ]] || { echo "--reinstate-by needs a name" >&2; exit 64; } ;;
    --branch) shift; BRANCH="${1:-}"; [[ -n "$BRANCH" ]] || { echo "--branch needs a name" >&2; exit 64; } ;;
    *) echo "unknown option: $1" >&2; exit 64 ;;
  esac
  shift
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMMON="$(git -C "$HERE" rev-parse --git-common-dir)"
MAIN="$(cd "$(dirname "$COMMON")" && pwd)"
say() { printf '\n== %s\n' "$*"; }
die() { printf '\nSTOPPED: %s\n' "$*" >&2; exit 1; }
# GitHub drops connections from this machine now and then: ask again before giving up.
retry() { local n; for n in 1 2 3 4 5 6; do "$@" && return 0; echo "  (attempt $n failed; trying again in 10 s)" >&2; sleep 10; done; return 1; }

# ── 1. checks ───────────────────────────────────────────────────────────────
say "1/6 checks in $MAIN"
cd "$MAIN"
[[ "$(git branch --show-current)" == "main" ]] || die "the main checkout is on '$(git branch --show-current)', not main"
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || { git status --short >&2; die "the main checkout is not clean"; }
git rev-parse --verify --quiet "$BRANCH" >/dev/null || die "branch $BRANCH does not exist here"
retry git fetch origin || die "could not fetch origin"
if ! git merge-base --is-ancestor main origin/main && git merge-base --is-ancestor origin/main main; then
  :  # main is ahead of origin/main: the push below sends the difference
elif git merge-base --is-ancestor main origin/main; then
  git merge --ff-only origin/main >/dev/null
else
  die "main and origin/main have diverged — somebody else pushed. Look at it before shipping."
fi
git merge-base --is-ancestor main "$BRANCH" || die "$BRANCH is not ahead of main in a straight line (main moved). It needs a merge of main first."
COUNT="$(git rev-list --count "main..$BRANCH")"
MIGRATIONS="$(git diff --name-only "main..$BRANCH" -- api/migrations | sed 's#.*/##' | tr '\n' ' ')"
echo "branch   : $BRANCH ($COUNT commit(s) ahead of main)"
echo "ships    : $(git log --oneline -1 "$BRANCH")"
echo "migrates : ${MIGRATIONS:-nothing}"
if [[ $DATA -eq 1 ]]; then
  DATA_PLAN="link sure accounts, extend short access"
  [[ $NAMES -eq 1 ]] && DATA_PLAN="$DATA_PLAN, link by name"
  [[ $OPEN -eq 1 ]] && DATA_PLAN="$DATA_PLAN, OPEN-ENDED converted"
  [[ -n "$REINSTATE" ]] && DATA_PLAN="$DATA_PLAN, re-open revoked by '$REINSTATE'"
else
  DATA_PLAN="skipped"
fi
echo "data     : $DATA_PLAN"
[[ -f deploy/release.local.env ]] || echo "WARNING: deploy/release.local.env is missing (the staging E2E password lives there)" >&2

if [[ $DRY -eq 1 ]]; then echo; echo "dry run: nothing was changed."; exit 0; fi
if [[ $ASSUME_YES -ne 1 ]]; then
  echo; echo "This merges into main, PUSHES, and RELEASES to production (with a backup first), then changes client data."
  read -r -p "Type yes to go on: " ANSWER
  [[ "$ANSWER" == "yes" ]] || die "not confirmed"
fi

# ── 2. merge and push ────────────────────────────────────────────────────────
say "2/6 merge and push"
git merge --ff-only "$BRANCH"
retry git push origin main || die "the push failed (main is merged locally; run it again to push)"
SHA="$(git rev-parse HEAD)"; SHORT="${SHA:0:12}"
echo "pushed $SHORT"

# ── 3. CI ────────────────────────────────────────────────────────────────────
ci_state() {
  local repo json
  repo="$(git remote get-url origin | sed -nE 's#^.*github\.com[:/]+([^/]+/[^/]+)$#\1#p' | sed 's#\.git$##')"
  [[ -n "$repo" ]] || { echo "unknown"; return; }
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    json="$(curl -fsS -H "Authorization: Bearer $GITHUB_TOKEN" "https://api.github.com/repos/$repo/actions/runs?head_sha=$SHA&per_page=100" 2>/dev/null)" || { echo "unknown"; return; }
  else
    json="$(curl -fsS "https://api.github.com/repos/$repo/actions/runs?head_sha=$SHA&per_page=100" 2>/dev/null)" || { echo "unknown"; return; }
  fi
  printf '%s' "$json" | node -e '
    let raw = ""; process.stdin.on("data", d => { raw += d; }).on("end", () => {
      let runs; try { runs = (JSON.parse(raw).workflow_runs || []).filter(r => r.name === "CI"); } catch { console.log("unknown"); return; }
      if (!runs.length) { console.log("none"); return; }
      const latest = new Map();
      for (const r of runs) { const s = latest.get(r.event); if (!s || new Date(r.created_at) > new Date(s.created_at)) latest.set(r.event, r); }
      const list = [...latest.values()];
      if (list.some(r => r.status !== "completed")) { console.log("pending"); return; }
      console.log(list.every(r => r.conclusion === "success") ? "success" : "failure");
    });'
}
say "3/6 GitHub Actions CI for $SHORT"
if [[ $CI_WAIT -eq 1 ]]; then
  WAITED=0; UNKNOWN=0
  while :; do
    STATE="$(ci_state)"
    case "$STATE" in
      success) echo "CI is green"; break ;;
      failure) die "CI is RED for $SHORT. Nothing was released. Fix it (main is already pushed)." ;;
      unknown) UNKNOWN=$((UNKNOWN + 1)); [[ $UNKNOWN -lt 6 ]] || die "cannot read CI from GitHub from this machine. Check it by hand, then: bash deploy/ship.sh --no-ci-wait --skip-data (and the data steps after)" ;;
      *) UNKNOWN=0 ;;
    esac
    [[ $WAITED -lt 2700 ]] || die "CI did not finish in 45 minutes (state: $STATE)"
    echo "  CI: $STATE ($((WAITED / 60)) min)"; sleep 30; WAITED=$((WAITED + 30))
  done
else
  echo "skipped (--no-ci-wait)"
fi

# ── 4. release ───────────────────────────────────────────────────────────────
say "4/6 release: backup, staging, E2E gate, production"
bash deploy/release-all.sh

# ── 5. production check ─────────────────────────────────────────────────────
load_env() { [[ -f "$1" ]] || return 0; local line; while IFS= read -r line || [[ -n "$line" ]]; do line="${line%$'\r'}"; [[ -z "$line" || "$line" =~ ^[[:space:]]*# || "$line" != *=* ]] && continue; local k="${line%%=*}" v="${line#*=}"; [[ "$k" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue; v="${v#\"}"; v="${v%\"}"; v="${v#\'}"; v="${v%\'}"; export "$k=$v"; done < "$1"; }
load_env deploy/release.local.env; load_env "${MAHAD_RELEASE_ENV:-$HOME/.mahad-release.env}"
api_env() { grep -m1 "^$1=" api/.env 2>/dev/null | cut -d= -f2- | tr -d '\r"' || true; }
: "${MAHAD_HOST:=$(api_env SSH_HOST)}"; : "${MAHAD_KEY:=$(api_env SSH_PRIVATE_KEY_FILE)}"; : "${MAHAD_USER:=$(api_env SSH_USER)}"
SSH_OPTS=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new); [[ -n "${MAHAD_KEY:-}" ]] && SSH_OPTS+=(-i "$MAHAD_KEY")
TARGET="${MAHAD_USER:-root}@${MAHAD_HOST:?set MAHAD_HOST}"
remote() { ssh "${SSH_OPTS[@]}" "$TARGET" "$@"; }

say "5/6 production health"
HEALTH="$(remote "curl -fsS --max-time 15 http://127.0.0.1:3001/api/health")" || die "production did not answer /api/health — look at it now"
echo "$HEALTH" | cut -c1-300
LAST_MIGRATION="$(ls api/migrations | grep -E '^[0-9]+.*\.sql$' | LC_ALL=C sort | tail -1)"
[[ "$HEALTH" == *"$LAST_MIGRATION"* ]] || die "production is up but does not report migration $LAST_MIGRATION"
echo "production runs $SHORT and reports $LAST_MIGRATION"

# ── 6. data ──────────────────────────────────────────────────────────────────
if [[ $DATA -eq 0 ]]; then say "6/6 data: skipped"; echo "done."; exit 0; fi
say "6/6 client data (on the server)"
FIX_DIR="/root/mahad-data-fixes/$(date +%Y%m%d-%H%M%S)"
run_tool() { remote "mkdir -p '$FIX_DIR' && cd '$FIX_DIR' && node /var/www/mahad-api/tools/$1"; }

echo "-- site accounts: report"
run_tool "link-site-accounts.cjs"
echo "-- site accounts: link"
run_tool "link-site-accounts.cjs --apply$([[ $NAMES -eq 1 ]] && echo ' --include-name-match')"

echo "-- year of access: report"
run_tool "set-year-access.cjs"
echo "-- year of access: apply"
FLAGS="--apply"
[[ $OPEN -eq 1 ]] && FLAGS="$FLAGS --include-open-ended"
[[ -n "$REINSTATE" ]] && FLAGS="$FLAGS --reinstate-revoked-by='$REINSTATE'"
run_tool "set-year-access.cjs $FLAGS"

say "done"
echo "released $SHORT to production; data fixes ran on the server."
echo "reports, CSVs and backups of every row changed: $TARGET:$FIX_DIR"
echo "(the report 'ALREADY PAST' line counts open-ended clients still left open; --open-ended converts them.)"
