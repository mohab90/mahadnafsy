'use strict';

// deploy-release.sh with extra web instances enabled on the server
// (deploy/MULTI_INSTANCE.md): after the folder swap it restarts the main unit,
// waits for it to answer, then each instance in turn, so one always answers.
// With no instance enabled it is the single restart it always was. The real
// script runs with systemctl, curl, npm and sleep replaced by stubs on PATH,
// as in stagingE2eGatesProduction.test.js; nothing here reaches a server.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.join(__dirname, '..', '..');
const hasBash = spawnSync('bash', ['-c', 'command -v sha256sum tar awk'], { encoding: 'utf8' }).status === 0;
const skip = process.platform === 'win32' || !hasBash ? 'needs a POSIX bash with sha256sum and tar' : false;

const write = (file, body, mode = 0o644) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, { mode });
};
const stub = (bin, name, body) => write(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, 0o755);

function server({ instances = '', downPorts = '', env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-rolling-'));
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
  for (const d of ['mahad-staging/api', 'admin-staging.mahadnafsy.com', 'staging.mahadnafsy.com',
    'mahad-api', 'admin.mahadnafsy.com', 'mahadnafsy.com']) fs.mkdirSync(path.join(dir, 'www', d), { recursive: true });
  write(path.join(dir, 'www', 'mahad-staging', 'api', '.env'), 'APP_RELEASE=mahad-000000000001\n');
  write(path.join(dir, 'www', 'mahad-api', '.env'), 'APP_RELEASE=mahad-000000000001\n');

  // INSTANCES: the units `systemctl list-units` reports, e.g.
  // "mahad-api-staging@3012 mahad-api-staging@3013". DISABLED: one of them
  // that is loaded but not enabled.
  stub(bin, 'systemctl', `echo "systemctl $*" >> "$CALLS"
case "$1" in
  list-units)
    pattern="\${@: -1}"; base="\${pattern%@*}"
    for unit in $INSTANCES; do
      [ "\${unit%@*}" = "$base" ] && echo "$unit.service loaded active running Mahad API web instance"
    done
    exit 0 ;;
  is-enabled)
    [[ "$*" == *-worker* ]] && exit 1
    [ -n "$DISABLED" ] && [[ "$*" == *"$DISABLED"* ]] && exit 1
    exit 0 ;;
  is-active) echo active ;;
esac
exit 0`);
  stub(bin, 'journalctl', 'exit 0');
  stub(bin, 'sleep', 'exit 0');
  stub(bin, 'npm', 'echo "npm $* in $PWD" >> "$CALLS"; exit 0');
  // Health per port: a port in DOWN_PORTS never answers "ok".
  stub(bin, 'curl', `url="\${@: -1}"; port=$(echo "$url" | sed -E 's#.*:([0-9]+)/.*#\\1#')
echo "curl :$port" >> "$CALLS"
for p in $DOWN_PORTS; do [ "$p" = "$port" ] && { echo '{"status":"down"}'; exit 0; }; done
echo '{"status":"ok","migration":"001_first.sql"}'`);

  const run = spawnSync('bash', [path.join(dir, 'deploy-release.sh'), R], {
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH}`, HOME: dir, CALLS: log, MAHAD_DEPLOY_TARGET: 'staging',
      INSTANCES: instances, DOWN_PORTS: downPorts, ...env,
    },
  });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  const live = fs.existsSync(path.join(dir, 'www', 'mahad-staging', 'api', 'migrations'));
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: run.status, out: run.stdout + run.stderr, calls, live };
}

const at = (calls, line) => calls.indexOf(line);

test('no instance enabled: the single restart, exactly as before', { skip }, () => {
  const s = server();
  assert.equal(s.status, 0, s.out);
  const restarts = s.calls.filter(line => line.startsWith('systemctl restart'));
  assert.deepEqual(restarts, ['systemctl restart mahad-api-staging']);
  assert.doesNotMatch(s.out, /rolling restart/);
});

test('with instances: the main unit, then each instance once the one before answers', { skip }, () => {
  const s = server({ instances: 'mahad-api-staging@3012 mahad-api-staging@3013 mahad-api@3011' });
  assert.equal(s.status, 0, s.out);
  assert.match(s.out, /rolling restart: mahad-api-staging \(:3002\), then mahad-api-staging@3012 mahad-api-staging@3013/);
  const main = at(s.calls, 'systemctl restart mahad-api-staging');
  const mainHealthy = s.calls.indexOf('curl :3002', main);
  const first = at(s.calls, 'systemctl restart mahad-api-staging@3012');
  const firstHealthy = s.calls.indexOf('curl :3012', first);
  const second = at(s.calls, 'systemctl restart mahad-api-staging@3013');
  assert.ok(main >= 0 && mainHealthy > main && first > mainHealthy, 'the first instance waits for the main unit to answer');
  assert.ok(firstHealthy > first && second > firstHealthy, 'the second waits for the first');
  assert.ok(s.calls.indexOf('curl :3013', second) > second);
  assert.equal(s.calls.filter(line => line === 'systemctl restart mahad-api@3011').length, 0, 'production\'s instances are not touched by the staging half');
  assert.equal(s.live, true);
  assert.match(s.out, /mahad-api-staging@3013 answers on :3013/);
});

test('an instance loaded but not enabled is left alone', { skip }, () => {
  const s = server({ instances: 'mahad-api-staging@3012 mahad-api-staging@3013', env: { DISABLED: '@3013' } });
  assert.equal(s.status, 0, s.out);
  assert.ok(s.calls.includes('systemctl restart mahad-api-staging@3012'));
  assert.equal(s.calls.includes('systemctl restart mahad-api-staging@3013'), false);
});

test('an instance that does not come back rolls every instance back, one at a time', { skip }, () => {
  const s = server({ instances: 'mahad-api-staging@3012 mahad-api-staging@3013', downPorts: '3013' });
  assert.equal(s.status, 1, s.out);
  assert.match(s.out, /mahad-api-staging@3013 did not answer on :3013/);
  assert.match(s.out, /rolling back/);
  assert.equal(s.live, false, 'the old release is back in the folder');
  const restarts = s.calls.filter(line => line.startsWith('systemctl restart'));
  assert.deepEqual(restarts.slice(0, 3), [
    'systemctl restart mahad-api-staging', 'systemctl restart mahad-api-staging@3012', 'systemctl restart mahad-api-staging@3013',
  ]);
  assert.deepEqual(restarts.slice(3, 5), ['systemctl restart mahad-api-staging', 'systemctl restart mahad-api-staging@3012'],
    'the rollback restarts them onto the old release in the same order');
});

test('a main unit that does not come back never takes an instance down', { skip }, () => {
  const s = server({ instances: 'mahad-api-staging@3012', downPorts: '3002' });
  assert.equal(s.status, 1, s.out);
  assert.match(s.out, /mahad-api-staging did not answer on :3002/);
  const firstRollback = s.calls.indexOf('systemctl restart mahad-api-staging', s.calls.indexOf('systemctl restart mahad-api-staging') + 1);
  const instanceRestart = s.calls.indexOf('systemctl restart mahad-api-staging@3012');
  assert.ok(firstRollback > 0 && (instanceRestart === -1 || instanceRestart > firstRollback),
    'the instance kept serving the old release until the rollback put it back under it');
});
