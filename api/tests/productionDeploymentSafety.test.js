'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const apiRoot = path.join(__dirname, '..');
const repoRoot = path.join(apiRoot, '..');
const readApi = relative => fs.readFileSync(path.join(apiRoot, relative), 'utf8');
const readRepo = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

test('legacy deployment entrypoints fail closed without credentials or remote mutation', () => {
  const entrypoints = [
    ['api', 'deploy_api.cjs'],
    ['api', 'upload_and_restart.cjs'],
    ['api', 'upload_env.cjs'],
    ['api', 'upload_env_and_restart.cjs'],
    ['admin', 'deploy_admin.cjs'],
    ['client', 'deploy_client.cjs'],
  ];
  for (const segments of entrypoints) {
    const source = fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');
    assert.match(source, /legacy-deploy-disabled/);
    assert.doesNotMatch(source, /password|fastPut|pkill|kill -9|SSH_PASS/);
  }
  const guard = readRepo('tools/legacy-deploy-disabled.cjs');
  assert.match(guard, /process\.exitCode = 78/);
});

test('SSH tooling supports key or agent authentication only', () => {
  for (const file of ['tunnel.js', 'tools/remote-readiness-inventory.cjs']) {
    const source = readApi(file);
    assert.match(source, /SSH_PRIVATE_KEY_FILE/);
    assert.match(source, /SSH_AUTH_SOCK/);
    assert.doesNotMatch(source, /SSH_PASS|keyboard-interactive|tryKeyboard|password\s*:/);
  }
});

test('admin monitoring never returns provider secrets or kills host processes', () => {
  const source = readApi('routes/server-monitor.js');
  assert.match(source, /configured: Boolean\(process\.env\.GEMINI_API_KEY\)/);
  assert.match(source, /MANAGED_RESTART_REQUIRED/);
  assert.doesNotMatch(source, /geminiKey:|child_process|spawn\(|kill -9|pkill|supervisor\.js/);
});

test('compatibility supervisor and watchdog never compete with the production process manager', () => {
  const supervisor = readApi('supervisor.js');
  const watchdog = readApi('watchdog.cjs');
  const shellWatchdog = readApi('watchdog.sh');
  assert.match(supervisor, /disabled in production/);
  assert.doesNotMatch(supervisor, /SIGKILL|killStaleServer|execSync|setTimeout\(start/);
  assert.doesNotMatch(watchdog, /require\('ssh2'\)|password\s*:|child_process|doRestart|\.connect\(/);
  assert.doesNotMatch(shellWatchdog, /systemctl|supervisor|kill|Authorization/);
});

test('release preparation requires a clean commit and emits SHA-256 evidence', () => {
  const prepare = readRepo('tools/prepare-release.mjs');
  const gate = readRepo('tools/pre-deploy-check.mjs');
  const activateApi = readRepo('deploy/activate-release.sh');
  const activateStatic = readRepo('deploy/activate-static-release.sh');
  const env = readApi('.env.example');
  assert.match(prepare, /status', '--porcelain/);
  assert.match(prepare, /--format=tar\.gz/);
  assert.match(prepare, /requiredBuilds/);
  assert.match(prepare, /artifactEvidence/);
  assert.match(prepare, /sha256/);
  assert.match(gate, /readiness:production:live/);
  for (const source of [activateApi, activateStatic]) {
    assert.match(source, /ACTUAL_SHA=.*sha256sum -- "\$ARTIFACT"/);
    assert.doesNotMatch(source, /sha256sum --check/);
    assert.match(source, /artifact links are not allowed/);
    assert.match(source, /--no-same-owner --no-same-permissions/);
  }
  assert.match(activateStatic, /component must be admin or client/);
  assert.match(activateStatic, /nginx -t/);
  assert.doesNotMatch(env, /^SSH_PASS=/m);
  assert.match(env, /^RUN_MIGRATIONS_ON_STARTUP=false$/m);
  assert.match(readApi('server.js'), /migrations are delegated to the release job/);
});

test('remote smoke workflow is staging-only and requires HTTPS', () => {
  const workflow = readRepo('.github/workflows/smoke.yml');
  const smoke = readRepo('tools/mahad-api-smoke.mjs');
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /SMOKE_BASE_URL/);
  assert.doesNotMatch(workflow, /production DB|SSH-tunnel|self-hosted/);
  assert.match(smoke, /must use HTTPS unless it targets localhost/);
});

// The release argument has to actually be used.
//
// deploy-release.sh accepted a release id, ignored it, and deployed whatever
// was hardcoded on line 16. On 2026-08-27 that silently rolled production back
// to an older build — the staff edit button and a finance fix disappeared and
// nobody could see why, because the deploy reported success against the release
// it had been asked for.
//
// It was found again a second time in a worse form: the fix lived in the repo
// while the server kept running its own stale copy, so a green test here would
// still have deployed the wrong thing. The hash comparison is an operator step
// and cannot be asserted from a unit test; what can be asserted is that the
// script in this repository has never quietly lost the fallback again.
test('the deploy script uses the release it was given', () => {
  const script = readRepo('deploy-release.sh');

  // `R=${1:-…}`: the argument wins, the literal is only a default.
  assert.match(script, /^R=\$\{1:-[a-z0-9-]+\}$/m,
    'the release must come from $1 with the hardcoded id as a fallback, never the other way round');
  assert.doesNotMatch(script, /^R=[a-z0-9-]+$/m,
    'a bare R=<release> ignores the argument and deploys a fixed build');

  // Staging is proved healthy before production is touched, and a production
  // failure rolls back rather than leaving a half-deployed box.
  assert.match(script, /deploy staging[\s\S]*STAGING FAILED - production untouched/,
    'staging must gate production');
  assert.ok(
    script.indexOf('deploy staging') < script.indexOf('deploy production'),
    'staging has to be deployed first to be a gate at all',
  );
  assert.match(script, /PRODUCTION FAILED - rolled back/);

  // 12 Oct 2026: the two halves run separately so the staging E2E can sit
  // between them, and the production half only ships what staging runs.
  assert.match(script, /^TARGET=\$\{MAHAD_DEPLOY_TARGET:-both\}$/m);
  assert.match(script, /if \[ "\$TARGET" = staging \]; then[\s\S]*?exit 0/);
  assert.match(script, /grep -qx "APP_RELEASE=\$R" "\$STAGING_API\/\.env"/,
    'production refuses unless staging already runs this release');
  // tools/release-gate.mjs cuts the script at this line for a staging-only run.
  assert.match(script, /^echo "staging is healthy; continuing to production"$/m);
  assert.ok(script.indexOf('if [ "$TARGET" = staging ]; then') < script.indexOf('\necho "staging is healthy; continuing to production"'));

  // The release id is stamped into the environment it deploys, so a report
  // from production can name its own build. Without it "is the fix live?" can
  // only be answered by reading files on the box, which is how the rollback
  // went unnoticed for as long as it did.
  assert.match(script, /APP_RELEASE=\$R/);

  // Run without its archives (1 Oct 2026: the upload had failed), it stamped
  // the new release name on the old code and restarted staging. It stops
  // before the first deploy now, having changed nothing.
  assert.ok(script.includes('[ -s "/staging/$R-$part.tgz" ] || {'), 'a missing archive must stop the run');
  assert.ok(script.indexOf('for part in api admin client; do') < script.indexOf('deploy() {'),
    'the archives are checked before anything is backed up, stamped or restarted');
});

// 11 Oct 2026: the schema before the code. Migrations ran after production was
// restarted on the new code, piped through tail so a failure still said DONE.
test('the deploy migrates before it switches the code, and checks what the API reports', () => {
  const script = readRepo('deploy-release.sh');
  const body = script.slice(script.indexOf('deploy() {'), script.indexOf('rollback_api() {'));
  const migrate = body.indexOf('npm run -s migrate');
  assert.ok(migrate > 0, 'deploy() runs the migrations');
  assert.ok(migrate < body.indexOf('systemctl restart "$svc"'), 'before the service restarts on the new code');
  assert.ok(migrate < body.indexOf('tar -xzf "/staging/$R-admin.tgz"'), 'before the admin is switched');
  assert.match(body, /MIGRATION FAILED[\s\S]*return 1/);
  assert.match(body, /applied_migration "\$port"/);
  assert.doesNotMatch(script, /npm run migrate 2>&1 \| grep/);
  assert.match(script, /tail -n \+4/, 'old archives are pruned to the last 3');

  const release = readRepo('deploy/release-all.sh');
  assert.match(release, /git branch -r --contains HEAD/);
  assert.match(release, /npm run release:gate -- --skip-live/);
  assert.match(release, /MAHAD_DEPLOY_EMERGENCY/);
  assert.ok(release.indexOf('release:gate') < release.indexOf('npm run release:prepare'));

  // The staging E2E is a gate, not a report: staging, then the specs, then
  // production — each half its own server call, the e2e run in between.
  const staging = release.indexOf('MAHAD_DEPLOY_TARGET=staging bash');
  const e2e = release.indexOf('npx playwright test "$spec"');
  const production = release.indexOf('MAHAD_DEPLOY_TARGET=production bash');
  assert.ok(staging > 0 && e2e > staging && production > e2e, 'production is deployed only after the staging E2E');
  assert.match(release, /tests\/public-smoke\.spec\.ts tests\/payment-flow\.spec\.ts/);
  assert.match(release, /MAHAD_SKIP_E2E/);
  assert.match(release, /npm run test:e2e:install/);
  assert.match(release, /PRODUCTION IS UNTOUCHED/);
  assert.equal((release.match(/npm run release:prepare/g) || []).length, 1, 'built once, for both halves');
});
