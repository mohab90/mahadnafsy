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
