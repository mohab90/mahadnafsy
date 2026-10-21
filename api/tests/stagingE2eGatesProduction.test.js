'use strict';

// Production goes live only after staging has passed the browser checks.
//
// Until 12 Oct 2026 deploy/release-all.sh deployed staging and production in
// one server call and only then ran public-smoke and payment-flow against
// staging, so a failure could be reported but never prevented. These tests run
// the real scripts with ssh, scp, npx, npm, git, systemctl and curl replaced by
// stubs on PATH, and read back what was called and in which order. Nothing
// here reaches a server.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.join(__dirname, '..', '..');
const hasBash = spawnSync('bash', ['-c', 'command -v sha256sum tar awk'], { encoding: 'utf8' }).status === 0;
// The stubs are POSIX shell scripts; Git Bash on Windows would run the real
// ssh before a PATH stub without an extension. CI runs these on Linux.
const skip = process.platform === 'win32' || !hasBash ? 'needs a POSIX bash with sha256sum and tar' : false;

const write = (file, body, mode = 0o644) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, { mode });
};
const stub = (bin, name, body) => write(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, 0o755);

// ── deploy/release-all.sh, from the laptop's side ───────────────────────────
const SHA = 'abcdef1234567890abcdef1234567890abcdef12';
const RELEASE = `mahad-${SHA.slice(0, 12)}`;

function laptop({ e2eInstalled = true, failSpec = '', env = {}, args = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-all-'));
  const root = path.join(dir, 'repo');
  const bin = path.join(dir, 'bin');
  const log = path.join(dir, 'calls.log');
  write(path.join(root, 'deploy', 'release-all.sh'), fs.readFileSync(path.join(repoRoot, 'deploy', 'release-all.sh'), 'utf8'));
  for (const f of ['deploy-release.sh', 'deploy/mahad-db-backup.sh', 'deploy/cron/mahad-restore-rehearsal']) write(path.join(root, f), '# stub\n');
  // The staging-password check asks the real staging over the network; here it answers with the exit code the test picks.
  write(path.join(root, 'tools', 'check-staging-gate.mjs'), "console.error('[staging-gate] stub'); process.exit(Number(process.env.GATE_RC || 0));\n");
  write(path.join(root, 'client', 'public', 'brand', 'logo.png'), 'x');
  write(path.join(root, 'client', 'public', 'brand', 'og.jpg'), 'x');
  if (e2eInstalled) fs.mkdirSync(path.join(root, 'e2e', 'node_modules', '@playwright', 'test'), { recursive: true });
  const releases = path.join(root, 'artifacts', 'releases');
  for (const part of ['api', 'admin', 'client']) {
    write(path.join(releases, `${RELEASE}-${part}.tgz`), `${part} archive\n`);
    spawnSync('bash', ['-c', `sha256sum ${RELEASE}-${part}.tgz > ${RELEASE}-${part}.tgz.sha256`], { cwd: releases });
  }

  stub(bin, 'git', `echo "git $*" >> "$CALLS"
case "$1" in
  status) exit 0 ;;
  rev-parse) echo ${SHA} ;;
  log) echo "${SHA.slice(0, 7)} the release" ;;
  fetch) exit 0 ;;
  branch) echo "  origin/main" ;;
  remote) echo "https://github.com/o/r.git" ;;
esac`);
  stub(bin, 'gh', 'exit 1');
  stub(bin, 'npm', 'echo "npm $*" >> "$CALLS"');
  stub(bin, 'sleep', 'exit 0');
  stub(bin, 'scp', 'echo "scp" >> "$CALLS"');
  // The server: its copy of the archives is the laptop's own, so the hash
  // comparison before production sees the same bytes unless a test says not.
  stub(bin, 'ssh', `cmd="\${@: -1}"
echo "ssh $cmd" >> "$CALLS"
case "$cmd" in
  *"grep -qx 'APP_RELEASE="*) exit "\${APP_RC:-0}" ;;
  *"sha256sum '"*) cd "$RELEASES" && sha256sum ${RELEASE}-api.tgz ${RELEASE}-admin.tgz ${RELEASE}-client.tgz | sed "s/^./\${REMOTE_HASH_PREFIX:-&}/" ;;
  *MAHAD_DEPLOY_TARGET=staging*) exit "\${STAGING_RC:-0}" ;;
  *MAHAD_DEPLOY_TARGET=production*) exit "\${PRODUCTION_RC:-0}" ;;
esac
exit 0`);
  stub(bin, 'npx', `echo "npx $* BASE_URL=$BASE_URL" >> "$CALLS"
[ -n "$FAIL_SPEC" ] && [[ "$*" == *"$FAIL_SPEC"* ]] && exit 1
exit 0`);

  const run = spawnSync('bash', [path.join(root, 'deploy', 'release-all.sh'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: dir,
      CALLS: log,
      RELEASES: releases,
      FAIL_SPEC: failSpec,
      MAHAD_HOST: 'server.test',
      MAHAD_KEY: path.join(dir, 'key'),
      ...env,
    },
  });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: run.status, out: run.stdout + run.stderr, calls };
}

const index = (calls, re) => calls.findIndex(line => re.test(line));

test('staging is deployed, then the E2E specs run, then production — from the same archives', { skip }, () => {
  const { status, out, calls } = laptop();
  assert.equal(status, 0, out);
  const staging = index(calls, /^ssh MAHAD_DEPLOY_TARGET=staging bash .*deploy-release\.sh' '/);
  const smoke = index(calls, /^npx playwright test tests\/public-smoke\.spec\.ts BASE_URL=https:\/\/staging\./);
  const payment = index(calls, /^npx playwright test tests\/payment-flow\.spec\.ts/);
  const hashes = calls.findLastIndex(line => /^ssh cd .*sha256sum '/.test(line));
  const production = index(calls, /^ssh MAHAD_DEPLOY_TARGET=production bash .*deploy-release\.sh' '/);
  const backups = calls.map((line, i) => (/mahad-db-backup\.sh$/.test(line) ? i : -1)).filter(i => i >= 0);
  assert.ok(staging > 0 && smoke > staging && payment > smoke, 'staging first, then both specs');
  assert.ok(hashes > payment && production > hashes, 'the server archives are re-checked before production');
  assert.equal(backups.length, 2, 'a backup before staging and a fresh one before production');
  assert.ok(backups[0] < staging && backups[1] > payment && backups[1] < production);
  assert.equal(calls.filter(line => line === 'scp').length, 1, 'uploaded once — production is not re-uploaded');
  assert.equal(calls.filter(line => /release:prepare/.test(line)).length, 1, 'built once — production is not rebuilt');
  assert.equal(calls.filter(line => /MAHAD_DEPLOY_TARGET=production/.test(line)).length, 1);
});

test('a failing spec stops before production and names the spec', { skip }, () => {
  const { status, out, calls } = laptop({ failSpec: 'payment-flow' });
  assert.equal(status, 79, out);
  assert.match(out, /STAGING E2E FAILED .*tests\/payment-flow\.spec\.ts/);
  assert.doesNotMatch(out, /FAILED .*public-smoke/);
  assert.match(out, /Staging now runs mahad-[0-9a-f]+\. PRODUCTION IS UNTOUCHED/);
  assert.ok(index(calls, /MAHAD_DEPLOY_TARGET=staging/) > 0);
  assert.equal(index(calls, /MAHAD_DEPLOY_TARGET=production/), -1, 'production must not be deployed');
});

test('a staging that asks for a password stops everything before anything is built, backed up or uploaded', { skip }, () => {
  const { status, out, calls } = laptop({ env: { GATE_RC: '81' } });
  assert.equal(status, 81, out);
  assert.match(out, /Nothing was built, backed up or uploaded/);
  assert.equal(index(calls, /^ssh /), -1);
  assert.equal(index(calls, /^npm /), -1, 'not even the dependencies are installed');
  assert.equal(index(calls, /^scp/), -1);
});

test('--resume-gate goes on from the E2E gate: no rebuild, no upload, no second staging deploy', { skip }, () => {
  const { status, out, calls } = laptop({ args: ['--resume-gate'] });
  assert.equal(status, 0, out);
  assert.match(out, /resuming at the E2E gate/);
  assert.equal(calls.filter(line => /^npm /.test(line)).length, 0, 'nothing is installed, tested or built again');
  assert.equal(calls.filter(line => line === 'scp').length, 0);
  assert.equal(index(calls, /MAHAD_DEPLOY_TARGET=staging/), -1);
  const smoke = index(calls, /^npx playwright test tests\/public-smoke\.spec\.ts/);
  const hashes = calls.findLastIndex(line => /^ssh cd .*sha256sum '/.test(line));
  const production = index(calls, /MAHAD_DEPLOY_TARGET=production/);
  assert.ok(smoke > 0 && hashes > smoke && production > hashes, 'the gate, then the hash check, then production');
  assert.equal(calls.filter(line => /mahad-db-backup\.sh$/.test(line)).length, 1, 'one fresh backup before production');
});

test('--resume-gate refuses when staging does not run this commit\'s release', { skip }, () => {
  const { status, out, calls } = laptop({ args: ['--resume-gate'], env: { APP_RC: '1' } });
  assert.equal(status, 78, out);
  assert.match(out, /staging does not run mahad-/);
  assert.equal(index(calls, /^npx /), -1);
  assert.equal(index(calls, /MAHAD_DEPLOY_TARGET=production/), -1);
});

test('without the e2e dependencies it stops before touching the server', { skip }, () => {
  const { status, out, calls } = laptop({ e2eInstalled: false });
  assert.equal(status, 80, out);
  assert.match(out, /npm run test:e2e:install/);
  assert.match(out, /MAHAD_SKIP_E2E/);
  assert.equal(index(calls, /^ssh /), -1, 'nothing is backed up, uploaded or deployed');
  assert.equal(index(calls, /release:prepare/), -1, 'nothing is built');
});

test('MAHAD_SKIP_E2E is the only way past, and it says so loudly', { skip }, () => {
  const { status, out, calls } = laptop({ e2eInstalled: false, env: { MAHAD_SKIP_E2E: 'laptop cannot install browsers' } });
  assert.equal(status, 0, out);
  assert.match(out, /WARNING — MAHAD_SKIP_E2E is set \(laptop cannot install browsers\)/);
  assert.match(out, /SKIPPED the staging E2E gate/);
  assert.equal(index(calls, /^npx /), -1);
  assert.ok(index(calls, /MAHAD_DEPLOY_TARGET=production/) > index(calls, /MAHAD_DEPLOY_TARGET=staging/));
});

test('a failed staging deploy, or archives changed on the server, never reach production', { skip }, () => {
  const failed = laptop({ env: { STAGING_RC: '1' } });
  assert.equal(failed.status, 76, failed.out);
  assert.match(failed.out, /production untouched/);
  assert.equal(index(failed.calls, /^npx /), -1);
  assert.equal(index(failed.calls, /MAHAD_DEPLOY_TARGET=production/), -1);

  const swapped = laptop({ env: { REMOTE_HASH_PREFIX: 'z' } });
  assert.equal(swapped.status, 65, swapped.out);
  assert.match(swapped.out, /no longer the ones staging was tested with/);
  assert.equal(index(swapped.calls, /MAHAD_DEPLOY_TARGET=production/), -1);
});

// ── deploy-release.sh, on the server's side ─────────────────────────────────
// The script's absolute paths are moved under a temporary folder; systemctl,
// curl and npm are stubs, tar and sha256sum are real.
function server({ target, stagingRelease, env = {}, npm, curl, before, after } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-release-'));
  const bin = path.join(dir, 'bin');
  const log = path.join(dir, 'calls.log');
  const R = 'mahad-000000000002';
  const script = fs.readFileSync(path.join(repoRoot, 'deploy-release.sh'), 'utf8')
    .replace(/\/staging(?=[/"' ]|$)/gm, `${dir}/staging`)
    .replaceAll('/var/www', `${dir}/www`)
    .replaceAll('/var/log', dir);
  write(path.join(dir, 'deploy-release.sh'), script);

  const src = path.join(dir, 'src');
  write(path.join(src, 'api', 'r', 'migrations', '001_first.sql'), '-- one\n');
  write(path.join(src, 'admin', 'index.html'), '<script src="index-abc.js"></script>');
  write(path.join(src, 'client', 'index.html'), 'site');
  const staging = path.join(dir, 'staging');
  fs.mkdirSync(staging, { recursive: true });
  spawnSync('tar', ['-czf', path.join(staging, `${R}-api.tgz`), '-C', path.join(src, 'api'), 'r']);
  spawnSync('tar', ['-czf', path.join(staging, `${R}-admin.tgz`), '-C', path.join(src, 'admin'), '.']);
  spawnSync('tar', ['-czf', path.join(staging, `${R}-client.tgz`), '-C', path.join(src, 'client'), '.']);
  for (const part of ['api', 'admin', 'client']) spawnSync('bash', ['-c', `sha256sum ${R}-${part}.tgz > ${R}-${part}.tgz.sha256`], { cwd: staging });
  for (const d of ['mahad-staging/api', 'admin-staging.mahadnafsy.com', 'staging.mahadnafsy.com',
    'mahad-api', 'admin.mahadnafsy.com', 'mahadnafsy.com']) fs.mkdirSync(path.join(dir, 'www', d), { recursive: true });
  write(path.join(dir, 'www', 'mahad-staging', 'api', '.env'), `APP_RELEASE=${stagingRelease || 'mahad-000000000001'}\n`);
  write(path.join(dir, 'www', 'mahad-api', '.env'), 'APP_RELEASE=mahad-000000000001\n');
  if (before) before(dir);

  stub(bin, 'systemctl', 'echo "systemctl $*" >> "$CALLS"; [ "$1" = is-active ] && echo active; [ "$1" = is-enabled ] && [ -z "$WORKER_ENABLED" ] && exit 1; exit 0');
  stub(bin, 'journalctl', 'exit 0');
  stub(bin, 'sleep', 'exit 0');
  stub(bin, 'npm', npm || 'echo "npm $* in $PWD" >> "$CALLS"; exit 0');
  stub(bin, 'curl', curl || 'echo \'{"status":"ok","migration":"001_first.sql"}\'');

  const run = spawnSync('bash', [path.join(dir, 'deploy-release.sh'), R], {
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir, CALLS: log, ...(target ? { MAHAD_DEPLOY_TARGET: target } : {}), ...env },
  });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
  const stagingEnv = fs.readFileSync(path.join(dir, 'www', 'mahad-staging', 'api', '.env'), 'utf8');
  const productionEnv = fs.readFileSync(path.join(dir, 'www', 'mahad-api', '.env'), 'utf8');
  if (after) after(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  return { R, status: run.status, out: run.stdout + run.stderr, calls, stagingEnv, productionEnv };
}

test('the staging half migrates and switches staging only', { skip }, () => {
  const s = server({ target: 'staging' });
  assert.equal(s.status, 0, s.out);
  assert.match(s.stagingEnv, new RegExp(`APP_RELEASE=${s.R}`));
  assert.match(s.productionEnv, /APP_RELEASE=mahad-000000000001/, 'production .env untouched');
  assert.match(s.calls, /systemctl restart mahad-api-staging/);
  assert.doesNotMatch(s.calls, /systemctl restart mahad-api\n/);
  assert.match(s.calls, /npm run -s migrate in .*mahad-staging\/api/);
  assert.doesNotMatch(s.calls, /migrate in .*www\/mahad-api/);
  assert.match(s.out, /live on STAGING only\. Production untouched/);
  assert.match(s.out, /prune old releases/);
});

test('the production half refuses unless staging already runs this release', { skip }, () => {
  const refused = server({ target: 'production' });
  assert.equal(refused.status, 1, refused.out);
  assert.match(refused.out, /REFUSED - staging does not run/);
  assert.equal(refused.calls, '', 'nothing restarted or migrated');

  const s = server({ target: 'production', stagingRelease: 'mahad-000000000002' });
  assert.equal(s.status, 0, s.out);
  assert.match(s.productionEnv, new RegExp(`APP_RELEASE=${s.R}`));
  assert.match(s.calls, /npm run -s migrate in .*www\/mahad-api/);
  assert.doesNotMatch(s.calls, /mahad-api-staging/, 'staging is not redeployed');
  assert.match(s.out, /DONE - release .* live on staging and production/);
});

test('an unknown target changes nothing', { skip }, () => {
  const s = server({ target: 'prod' });
  assert.equal(s.status, 1);
  assert.match(s.out, /MAHAD_DEPLOY_TARGET must be staging, production or both/);
  assert.equal(s.calls, '');
});

test('run by hand with no target, it still does staging and then production', { skip }, () => {
  const s = server({});
  assert.equal(s.status, 0, s.out);
  assert.match(s.stagingEnv, new RegExp(`APP_RELEASE=${s.R}`));
  assert.match(s.productionEnv, new RegExp(`APP_RELEASE=${s.R}`));
  assert.ok(s.calls.indexOf('restart mahad-api-staging') < s.calls.indexOf('restart mahad-api\n'));
});

// 21 Oct 2026: the API release is assembled and installed beside the running
// one and swapped in by rename, so the live folder's node_modules are never
// wiped while it serves, and a failed install or migration changes nothing.
test('dependencies are installed in a separate folder and swapped in with the uploads', { skip }, () => {
  let live, prev, next;
  const s = server({
    target: 'staging',
    before: dir => {
      const api = path.join(dir, 'www', 'mahad-staging', 'api');
      write(path.join(api, 'uploads', 'videos', 'lecture.mp4'), 'video');
      write(path.join(api, 'node_modules', 'old', 'index.js'), 'old');
      write(path.join(api, 'server-kept.txt'), 'kept by the server');
    },
    after: dir => {
      const api = path.join(dir, 'www', 'mahad-staging', 'api');
      const has = f => fs.existsSync(path.join(api, f));
      live = { upload: has('uploads/videos/lecture.mp4'), kept: has('server-kept.txt'), migration: has('migrations/001_first.sql'), oldModules: has('node_modules/old/index.js') };
      prev = fs.existsSync(path.join(`${api}.prev`, 'node_modules', 'old', 'index.js')) && !fs.existsSync(path.join(`${api}.prev`, 'uploads'));
      next = fs.existsSync(`${api}.next`);
    },
  });
  assert.equal(s.status, 0, s.out);
  assert.match(s.calls, /npm ci --omit=dev .* in .*mahad-staging\/api\.next\n/, 'installed in the new folder');
  assert.doesNotMatch(s.calls, /npm ci .* in .*mahad-staging\/api\n/, 'never in the live folder');
  assert.match(s.calls, /npm run -s migrate in .*mahad-staging\/api\.next\n/);
  assert.deepEqual(live, { upload: true, kept: true, migration: true, oldModules: false });
  assert.equal(prev, true, 'the previous release is kept whole, without the uploads');
  assert.equal(next, false);
  assert.equal((s.calls.match(/systemctl restart mahad-api-staging/g) || []).length, 1, 'one restart');
});

test('a failed install or migration leaves the running release untouched and unrestarted', { skip }, () => {
  for (const failing of ['ci', 'run']) {
    let liveRelease, next;
    const s = server({
      target: 'staging',
      npm: `echo "npm $* in $PWD" >> "$CALLS"; [ "$1" = ${failing} ] && exit 1; [ "$1" = install ] && [ ${failing} = ci ] && exit 1; exit 0`,
      after: dir => {
        const api = path.join(dir, 'www', 'mahad-staging', 'api');
        liveRelease = fs.existsSync(path.join(api, 'migrations'));
        next = fs.existsSync(`${api}.next`);
      },
    });
    assert.equal(s.status, 1, s.out);
    assert.match(s.out, failing === 'ci' ? /npm could not install/ : /MIGRATION FAILED/);
    assert.match(s.stagingEnv, /APP_RELEASE=mahad-000000000001/, 'the live .env is unchanged');
    assert.equal(liveRelease, false, 'the live folder never received the new release');
    assert.equal(next, false, 'the half-built folder is removed');
    assert.doesNotMatch(s.calls, /systemctl restart/, 'nothing was restarted');
  }
});

test('an unhealthy release is swapped back with the uploads made meanwhile', { skip }, () => {
  let upload, liveRelease;
  const s = server({
    target: 'staging',
    curl: 'echo \'{"status":"down"}\'',
    before: dir => write(path.join(dir, 'www', 'mahad-staging', 'api', 'uploads', 'a.jpg'), 'img'),
    after: dir => {
      const api = path.join(dir, 'www', 'mahad-staging', 'api');
      upload = fs.existsSync(path.join(api, 'uploads', 'a.jpg'));
      liveRelease = fs.existsSync(path.join(api, 'migrations'));
    },
  });
  assert.equal(s.status, 1, s.out);
  assert.match(s.out, /rolling back/);
  assert.match(s.stagingEnv, /APP_RELEASE=mahad-000000000001/);
  assert.equal(upload, true);
  assert.equal(liveRelease, false);
});

test('an enabled background worker follows the API onto the new release', { skip }, () => {
  const without = server({ target: 'staging' });
  assert.equal(without.status, 0, without.out);
  assert.doesNotMatch(without.calls, /restart mahad-api-staging-worker/, 'no worker unless its unit was enabled');
  const s = server({ target: 'staging', env: { WORKER_ENABLED: '1' } });
  assert.equal(s.status, 0, s.out);
  assert.ok(s.calls.indexOf('restart mahad-api-staging\n') < s.calls.indexOf('restart mahad-api-staging-worker'));
});
