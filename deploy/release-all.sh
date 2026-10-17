#!/usr/bin/env bash
# The whole release, one command, for the /var/www + systemd server
# (deploy-release.sh is the half that runs ON the server).
#
#   bash deploy/release-all.sh
#
# The server and key come from api/.env (SSH_HOST, SSH_PRIVATE_KEY_FILE, SSH_USER) and the rest from
# deploy/release.local.env (git-ignored; copy deploy/release.local.env.example) — nothing is typed.
# MAHAD_HOST / MAHAD_KEY on the command line still win.
#   add --prepare-only to stop after the archives are built (nothing is uploaded)
#   add --resume-gate when staging already runs this commit's release and only the E2E gate
#       (step 9) stopped it: skips the rebuild, upload and staging deploy and goes on from the
#       gate — the server itself refuses production unless staging runs exactly this release
#
# What it does, in order, and stops at the first thing that is wrong:
#   1. refuses a worktree that is not clean, a commit that is on no remote
#      branch, a commit whose GitHub Actions CI is not green, and a machine
#      without the e2e dependencies step 9 needs
#   2. installs the API's and the two front ends' dependencies
#   3. npm run release:gate -- --skip-live (lint, unit tests, quality, builds,
#      dependency audit; the live readiness half needs production's secrets)
#   4. release:prepare — retried, because on Windows an antivirus can lock a freshly
#      written file for a second and tar then fails with «Permission denied»
#   5. checks the archives really are THIS commit's (an old release in artifacts/
#      once got uploaded in place of a failed build)
#   6. takes a database backup on the server and refuses to go on if it failed
#   7. uploads the archives (and the backup script and restore-rehearsal cron)
#      and checks their checksums on the server
#   8. deploys STAGING only (MAHAD_DEPLOY_TARGET=staging deploy-release.sh): its
#      migrations run before the new code is switched on, and the API must then
#      report the newest migration the release ships
#   9. runs the public smoke and payment-flow E2E specs against staging from
#      this machine — the gate: a failure stops here, production untouched
#  10. production: checks the archives on the server are still byte for byte
#      the ones staging was tested with, takes a fresh backup (the E2E took
#      minutes in which payments kept arriving), then deploys PRODUCTION only
#      from those same archives — nothing is rebuilt or re-uploaded
#
# Settings (all optional):
#   MAHAD_DEPLOY_EMERGENCY='<why>'  turns the step-1/3 refusals (not on a remote
#                                   branch, CI not green, release gate failing)
#                                   into warnings. For an outage, not for haste.
#   MAHAD_SKIP_E2E='<why>'          production goes live WITHOUT the step-9 E2E
#                                   gate (e.g. Playwright cannot be installed on
#                                   this machine). Loud warning; the reason is
#                                   printed with it.
#   GITHUB_TOKEN / a logged-in gh   how CI is checked; with neither, a warning
#   MAHAD_GITHUB_REPO=owner/repo    when origin is not a github.com URL
#   MAHAD_E2E_STAGING_URL           staging's origin (https://staging.mahadnafsy.com)
#   E2E_BASIC_AUTH=user:pass        staging's nginx gate, if it has one
#   TEST_STUDENT_EMAIL / TEST_STUDENT_PASSWORD   the staging student the payment
#                                   flow signs in as
#
# Authentication is your SSH key only; nothing is typed, stored or printed.
set -euo pipefail

PREPARE_ONLY=0
RESUME_GATE=0
for arg in "$@"; do
  case "$arg" in
    --prepare-only) PREPARE_ONLY=1 ;;
    --resume-gate) RESUME_GATE=1 ;;
    *) echo "unknown option: $arg" >&2; exit 64 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Settings that belong to this machine, read once instead of typed on every release: the staging
# password for the E2E, a GitHub token, the server. deploy/release.local.env is git-ignored (see
# deploy/release.local.env.example); ~/.mahad-release.env is the same thing kept outside the repo.
# Read literally, line by line (KEY=value) and never run as shell code: a password with a $, &, ; or (
# in it would be cut or executed. One pair of surrounding quotes is tolerated and dropped.
load_settings() {
  local line key value
  local single="'" double='"'
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    key="${line%%=*}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    value="${line#*=}"
    if [[ "${#value}" -ge 2 && ( ( "${value:0:1}" == "$single" && "${value: -1}" == "$single" ) \
        || ( "${value:0:1}" == "$double" && "${value: -1}" == "$double" ) ) ]]; then
      value="${value:1:${#value}-2}"
    fi
    export "$key=$value"
  done < "$1"
}
for settings in "$ROOT/deploy/release.local.env" "${MAHAD_RELEASE_ENV:-$HOME/.mahad-release.env}"; do
  if [[ -f "$settings" ]]; then
    load_settings "$settings"
    echo "settings read from $settings"
  fi
done
# The server and the key are already named in api/.env (the tunnel uses them), so they need no typing.
api_env() { grep -m1 "^$1=" api/.env 2>/dev/null | cut -d= -f2- | tr -d '\r"' || true; }
if [[ "$PREPARE_ONLY" -eq 0 ]]; then
  : "${MAHAD_HOST:=$(api_env SSH_HOST)}"
  : "${MAHAD_KEY:=$(api_env SSH_PRIVATE_KEY_FILE)}"
  : "${MAHAD_USER:=$(api_env SSH_USER)}"
fi

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
say "1/10 the commit"
# The logo and share image live on the institute's own domain (/brand/). The
# server this was written on could not download them; this machine can. Fetched
# once here, before the clean-tree check, and then they must be committed — the
# release packages only committed source.
if [ ! -f client/public/brand/logo.png ] || [ ! -f client/public/brand/og.jpg ]; then
  if node tools/fetch-brand-assets.mjs; then
    echo "The logo and share image were fetched into client/public/brand/." >&2
    echo "Commit and push them once, then run this again:" >&2
    echo "  git add client/public/brand && git commit -m 'brand files' && git push origin HEAD:claude/compassionate-cannon-1vztov" >&2
    exit 1
  fi
  echo "WARNING: could not fetch the brand files; nginx serves the old hosted logo for /brand/ until they exist" >&2
fi
if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
  echo "the worktree is not clean — release from a clean checkout of the commit:" >&2
  git status --short >&2
  exit 65
fi
COMMIT="$(git rev-parse HEAD)"
SHORT="${COMMIT:0:12}"
echo "releasing $(git log --oneline -1)"

# A refusal below, unless MAHAD_DEPLOY_EMERGENCY says why it must go anyway.
EMERGENCY="${MAHAD_DEPLOY_EMERGENCY:-}"
refuse() {
  if [[ -n "$EMERGENCY" ]]; then
    echo "WARNING — going on under MAHAD_DEPLOY_EMERGENCY ($EMERGENCY): $*" >&2
    return 0
  fi
  echo "REFUSED: $*" >&2
  echo "(in a real emergency: MAHAD_DEPLOY_EMERGENCY='<why>' turns this into a warning)" >&2
  exit 67
}

# The staging E2E gate (step 9) and its one way round.
SKIP_E2E="${MAHAD_SKIP_E2E:-}"
E2E_URL="${MAHAD_E2E_STAGING_URL:-https://staging.mahadnafsy.com}"
E2E_SPECS=(tests/public-smoke.spec.ts tests/payment-flow.spec.ts)
e2e_installed() { [[ -d e2e/node_modules/@playwright/test ]]; }
skip_e2e_warning() {
  [[ -n "$SKIP_E2E" ]] || return 0
  echo >&2
  echo "!!! WARNING — MAHAD_SKIP_E2E is set ($SKIP_E2E)." >&2
  echo "!!! The staging E2E gate will NOT run: production goes live without public-smoke" >&2
  echo "!!! and payment-flow having passed on staging. Check staging by hand afterwards." >&2
  echo >&2
}

# What GitHub Actions says about this commit's «CI» workflow: success, pending,
# failure, none, unknown, or unavailable (no gh login and no GITHUB_TOKEN).
ci_state() {
  local repo query json
  repo="${MAHAD_GITHUB_REPO:-$(git remote get-url origin 2>/dev/null \
    | sed -nE 's#^.*github\.com[:/]+([^/]+/[^/]+)$#\1#p' | sed 's#\.git$##')}"
  query="repos/$repo/actions/runs?head_sha=$COMMIT&per_page=100"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    [[ -n "$repo" ]] || { echo "unknown: origin is not a github.com URL (set MAHAD_GITHUB_REPO=owner/repo)"; return; }
    json="$(gh api "$query" 2>/dev/null)" || { echo "unknown: gh api failed for $repo"; return; }
  elif [[ -n "${GITHUB_TOKEN:-}" ]]; then
    [[ -n "$repo" ]] || { echo "unknown: origin is not a github.com URL (set MAHAD_GITHUB_REPO=owner/repo)"; return; }
    json="$(curl -fsS -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" \
      "https://api.github.com/$query" 2>/dev/null)" || { echo "unknown: the GitHub API refused or failed for $repo"; return; }
  else
    echo "unavailable"; return
  fi
  # The newest run per trigger (push, pull_request, …) is the one that counts:
  # a re-run that went green replaces the red run before it.
  printf '%s' "$json" | node -e '
    let raw = "";
    process.stdin.on("data", d => { raw += d; }).on("end", () => {
      let runs;
      try { runs = (JSON.parse(raw).workflow_runs || []).filter(r => r.name === process.argv[1]); }
      catch { console.log("unknown: unreadable answer from GitHub"); return; }
      if (!runs.length) { console.log("none: no CI run for this commit — has it been pushed?"); return; }
      const latest = new Map();
      for (const r of runs) {
        const seen = latest.get(r.event);
        if (!seen || new Date(r.created_at) > new Date(seen.created_at)) latest.set(r.event, r);
      }
      const newest = [...latest.values()];
      const urls = list => list.map(r => r.html_url).join(" ");
      if (newest.some(r => r.status !== "completed")) { console.log(`pending: still running ${urls(newest)}`); return; }
      const red = newest.filter(r => r.conclusion !== "success");
      console.log(red.length ? `failure: ${red.map(r => r.conclusion).join(",")} ${urls(red)}` : `success: ${urls(newest)}`);
    });' "CI"
}

if [[ "$PREPARE_ONLY" -eq 0 ]]; then
  # Only a commit somebody else can see may reach production: a build of a
  # commit that lives on one laptop cannot be reviewed, rebuilt or rolled
  # forward from anywhere else. Asked after a fetch, so it is GitHub's answer
  # and not a stale remote-tracking ref's.
  if git fetch --quiet origin; then
    ON_REMOTE="$(git branch -r --contains HEAD 2>/dev/null | sed 's/^[* ]*//' | grep -v -- '->' | tr '\n' ' ' || true)"
    if [[ -n "$ON_REMOTE" ]]; then
      echo "on remote branch(es): $ON_REMOTE"
    else
      refuse "$SHORT is on no remote branch — push it first (git push origin HEAD)"
    fi
  else
    refuse "git fetch origin failed, so it cannot be checked that $SHORT was pushed"
  fi

  CI="$(ci_state)"
  case "$CI" in
    success*)    echo "GitHub Actions CI is green for $SHORT" ;;
    unavailable) echo "WARNING: CI status NOT checked — log in with «gh auth login» or set GITHUB_TOKEN to have it checked" >&2 ;;
    *)           refuse "GitHub Actions CI is not green for $SHORT — $CI" ;;
  esac

  # Step 9 is what lets production go live, so a machine that cannot run it is
  # found out here, before anything is built, backed up or uploaded — not after
  # staging already carries the release.
  skip_e2e_warning
  if [[ -z "$SKIP_E2E" ]] && ! e2e_installed; then
    echo >&2
    echo "STOPPED: the e2e dependencies are not installed on this machine." >&2
    echo "Production only goes live after public-smoke and payment-flow pass on staging" >&2
    echo "(step 9), and they run from here. Install them once, then run this again:" >&2
    echo "  npm run test:e2e:install" >&2
    echo "Nothing was built, backed up or uploaded. Only if they truly cannot run here:" >&2
    echo "  MAHAD_SKIP_E2E='<why>' — production then goes live without the gate." >&2
    exit 80
  fi

  # Staging sits behind an nginx password, and the E2E answered 401 to everything when it was not
  # given (17 Oct 2026) — found out at step 9, with staging already switched. Asked here, first.
  if [[ -z "$SKIP_E2E" ]]; then
    gate_rc=0
    node tools/check-staging-gate.mjs "$E2E_URL" || gate_rc=$?
    if [[ "$gate_rc" -ne 0 ]]; then
      echo "Nothing was built, backed up or uploaded." >&2
      echo "(Only if the gate truly cannot be passed: MAHAD_SKIP_E2E='<why>' — production then goes live without it.)" >&2
      exit "$gate_rc"
    fi
  fi

  if [[ "$RESUME_GATE" -eq 1 ]]; then
    # Staging must already run this commit's release: deploy-release.sh refuses production otherwise,
    # but that is after the E2E has run for nothing, so it is asked here. Only the APP_RELEASE line is
    # compared — nothing else of the server's .env is read or shown.
    if ssh "${SSH_OPTS[@]}" "$TARGET" "grep -qx 'APP_RELEASE=mahad-$SHORT' '${MAHAD_STAGING_API_ENV:-/var/www/mahad-staging/api/.env}'"; then
      echo "staging runs mahad-$SHORT — resuming at the E2E gate"
    else
      echo "REFUSED: staging does not run mahad-$SHORT, so there is nothing to resume — run this without --resume-gate." >&2
      exit 78
    fi
  fi
fi

# ── 2. dependencies ──────────────────────────────────────────────────────────
if [[ "$RESUME_GATE" -eq 0 ]]; then
say "2/10 dependencies"
# The API's are for the release gate's lint and unit tests only — the server
# installs its own. --ignore-scripts because its native extras (bcrypt, ssh2's
# cpu-features) need a compiler a Windows laptop may not have, and each has a
# pure-JS fallback the tests already use.
npm ci --prefix api --ignore-scripts --no-audit --no-fund
npm ci --prefix admin --no-audit --no-fund
npm ci --prefix client --no-audit --no-fund

# ── 3. release gate ──────────────────────────────────────────────────────────
if [[ "$PREPARE_ONLY" -eq 0 ]]; then
  say "3/10 release gate (lint, unit tests, quality, builds, dependency audit)"
  npm run release:gate -- --skip-live || refuse "npm run release:gate failed — see above"
else
  say "3/10 release gate skipped (--prepare-only uploads nothing)"
fi

# ── 4. the archives ──────────────────────────────────────────────────────────
say "4/10 building the release (admin and client are rebuilt inside this step)"
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
else
  say "2-4/10 skipped (--resume-gate): the archives built for this commit are used"
fi

# ── 5. they are this commit's ────────────────────────────────────────────────
say "5/10 checking the archives"
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

# ── 6. backup ────────────────────────────────────────────────────────────────
# Exit 3 is mahad-db-backup.sh saying the dump on the server is good but its
# off-site copy is missing or failed. The deploy only needs the first to be
# safe, so it goes on — loudly, because the second means the business has one
# copy of its data, on the same disk as the data.
backup() { # <what a failure leaves unchanged>
  local rc=0
  ssh "${SSH_OPTS[@]}" "$TARGET" "$BACKUP_CMD" || rc=$?
  case "$rc" in
    0) ;;
    3)
      echo >&2
      echo "!!! ALERT: the backup was taken on the server, but NO OFF-SITE COPY was made." >&2
      echo "!!! Every copy of the database is on that one machine. Configure the off-site" >&2
      echo "!!! destination (deploy/README_AR.md, «النسخ الاحتياطي خارج السيرفر») today." >&2
      echo >&2
      ;;
    *) echo "the backup failed — $1" >&2; exit 75 ;;
  esac
}
if [[ "$RESUME_GATE" -eq 0 ]]; then
say "6/10 database backup on the server"
backup "nothing was changed on the server"

# ── 7. upload and verify ─────────────────────────────────────────────────────
say "7/10 uploading to $TARGET:$STAGING"
ssh "${SSH_OPTS[@]}" "$TARGET" "mkdir -p '$STAGING'"
scp "${SSH_OPTS[@]}" \
  "artifacts/releases/$RELEASE-api.tgz" "artifacts/releases/$RELEASE-api.tgz.sha256" \
  "artifacts/releases/$RELEASE-admin.tgz" "artifacts/releases/$RELEASE-admin.tgz.sha256" \
  "artifacts/releases/$RELEASE-client.tgz" "artifacts/releases/$RELEASE-client.tgz.sha256" \
  "deploy-release.sh" "deploy/mahad-db-backup.sh" "deploy/cron/mahad-restore-rehearsal" \
  "$TARGET:$STAGING/"
ssh "${SSH_OPTS[@]}" "$TARGET" "cd '$STAGING' && sha256sum --check --status \
  '$RELEASE-api.tgz.sha256' '$RELEASE-admin.tgz.sha256' '$RELEASE-client.tgz.sha256'" \
  || { echo "checksum mismatch after upload — nothing was activated" >&2; exit 65; }
echo "checksums verified on the server"

# ── 8. staging ───────────────────────────────────────────────────────────────
say "8/10 deploying to STAGING only (migrations before the switch; rolls back by itself)"
ssh "${SSH_OPTS[@]}" "$TARGET" "MAHAD_DEPLOY_TARGET=staging bash '$STAGING/deploy-release.sh' '$RELEASE'" \
  || { echo "the staging deploy stopped on the server (see above) — production untouched" >&2; exit 76; }
else
  say "6-8/10 skipped (--resume-gate): staging already runs $RELEASE"
fi

# ── 9. the gate: staging end-to-end ──────────────────────────────────────────
# The specs a visitor's path depends on — the public pages, the API, signing
# in as a student and reaching the checkout — run against staging, which now
# carries this exact release and its migrated database, and production waits
# for them. Until 12 Oct 2026 they ran after production was already live, so
# a failure could only be reported, not prevented. One spec at a time, so a
# failure names its spec and the other still runs.
say "9/10 staging end-to-end — the gate for production (public smoke + payment flow)"
if [[ -n "$SKIP_E2E" ]]; then
  skip_e2e_warning
  echo "!!! SKIPPED the staging E2E gate for $RELEASE (MAHAD_SKIP_E2E: $SKIP_E2E)" >&2
elif ! e2e_installed; then
  # Checked in step 1 already; here only if they vanished since.
  echo "STOPPED: the e2e dependencies are not installed (npm run test:e2e:install)." >&2
  echo "Staging now runs $RELEASE; PRODUCTION IS UNTOUCHED." >&2
  exit 80
else
  FAILED_SPECS=()
  for spec in "${E2E_SPECS[@]}"; do
    echo "-- $spec against $E2E_URL"
    ( cd e2e && BASE_URL="$E2E_URL" API_BASE_URL="${MAHAD_E2E_STAGING_API_URL:-$E2E_URL}" \
        npx playwright test "$spec" ) || FAILED_SPECS+=("$spec")
  done
  if [[ "${#FAILED_SPECS[@]}" -gt 0 ]]; then
    echo >&2
    echo "STAGING E2E FAILED against $E2E_URL: ${FAILED_SPECS[*]}" >&2
    echo "Staging now runs $RELEASE. PRODUCTION IS UNTOUCHED — it still runs its previous release." >&2
    echo "Fix the cause and release again. If Playwright says a browser is missing:" >&2
    echo "  npm run test:e2e:install" >&2
    exit 79
  fi
  echo "staging E2E passed against $E2E_URL"
fi

# ── 10. production ───────────────────────────────────────────────────────────
say "10/10 production (the same archives staging was tested with)"
# Production deploys the archives already in $STAGING — never a rebuild, never
# a new upload. Their hashes on the server are compared with this machine's
# copies, so what goes live is byte for byte what staging ran. Only the hash
# column is compared: sha256sum in Git Bash on Windows marks names with «*».
LOCAL_SUMS="$(cd artifacts/releases && sha256sum "$RELEASE-api.tgz" "$RELEASE-admin.tgz" "$RELEASE-client.tgz" | awk '{print $1}')"
REMOTE_SUMS="$(ssh "${SSH_OPTS[@]}" "$TARGET" "cd '$STAGING' && sha256sum '$RELEASE-api.tgz' '$RELEASE-admin.tgz' '$RELEASE-client.tgz'" | awk '{print $1}')" || true
if [[ -z "$REMOTE_SUMS" ]]; then
  echo "could not read the archives' checksums on the server — production untouched" >&2
  exit 65
fi
if [[ "$LOCAL_SUMS" != "$REMOTE_SUMS" ]]; then
  echo "the archives on the server are no longer the ones staging was tested with — production untouched" >&2
  exit 65
fi
echo "archives on the server unchanged since staging was tested"
# A second backup: the first was taken before staging, and payments kept
# arriving while the E2E ran. This one is what production's migrations follow.
backup "production untouched (staging runs $RELEASE)"
ssh "${SSH_OPTS[@]}" "$TARGET" "MAHAD_DEPLOY_TARGET=production bash '$STAGING/deploy-release.sh' '$RELEASE'" \
  || { echo "the production deploy stopped on the server (see above) — it rolled back by itself; staging runs $RELEASE" >&2; exit 77; }

say "released $RELEASE (staging and production)"
