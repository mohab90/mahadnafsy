'use strict';
/**
 * «محتاجين نحل مشكله الرفع والنشر دي للاخر ونهائيا» (17 Oct 2026).
 *
 * release-all.sh built, uploaded and deployed to staging, and only then ran the E2E — which answered
 * 401 to everything, because staging is behind an nginx password the run was never given. Production was
 * (rightly) not touched, but the release stopped half done, and would have stopped the same way next time:
 * the API specs open their own clients, which never saw the password even when it was set.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

async function gate() { return import(pathToFileURL(path.join(ROOT, 'tools', 'check-staging-gate.mjs')).href); }

/** A staging stand-in behind basic auth: 200 for user:secret, 401 for anything else. */
function stagingBehindAPassword() {
  const expected = `Basic ${Buffer.from('release:secret').toString('base64')}`;
  const server = http.createServer((req, res) => {
    if (req.headers.authorization === expected) { res.writeHead(200); res.end('ok'); } else { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="staging"' }); res.end(); }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}

test('the gate check tells a missing password, a wrong one and a right one apart — before anything is built', async () => {
  const { checkStagingGate } = await gate();
  const { server, origin } = await stagingBehindAPassword();
  try {
    const none = await checkStagingGate(origin, { credentials: '' });
    assert.deepEqual([none.code, none.state], [81, 'needs-credentials']);
    assert.match(none.message, /release\.local\.env/);
    const wrong = await checkStagingGate(origin, { credentials: 'release:nope' });
    assert.deepEqual([wrong.code, wrong.state], [82, 'wrong-credentials']);
    const right = await checkStagingGate(origin, { credentials: 'release:secret' });
    assert.deepEqual([right.code, right.state], [0, 'open']);
    assert.ok(!JSON.stringify([none, wrong, right]).includes('secret'), 'the password is never echoed');
  } finally { server.close(); }
});

test('a staging that does not answer yet is not a reason to stop: it is about to be deployed', async () => {
  const { checkStagingGate } = await gate();
  const result = await checkStagingGate('http://127.0.0.1:1', { credentials: '' });
  assert.deepEqual([result.code, result.state], [0, 'unreachable']);
});

test('an open staging (no password at all) passes', async () => {
  const { checkStagingGate } = await gate();
  const server = http.createServer((req, res) => { res.writeHead(200); res.end('ok'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await checkStagingGate(`http://127.0.0.1:${server.address().port}`, { credentials: '' });
    assert.equal(result.code, 0);
  } finally { server.close(); }
});

test('the release script asks about the gate first, reads its settings itself and can resume at the gate', () => {
  const script = read('deploy/release-all.sh');
  const check = script.indexOf('node tools/check-staging-gate.mjs "$E2E_URL"');
  assert.ok(check > 0, 'the gate is checked');
  assert.ok(check < script.indexOf('say "2/10 dependencies"'), 'before the first build step');
  assert.ok(check < script.indexOf('say "8/10 deploying to STAGING'), 'and long before staging is switched');
  assert.match(script, /deploy\/release\.local\.env/);
  assert.match(script, /api_env SSH_HOST/, 'the server comes from api/.env');
  assert.match(script, /--resume-gate\) RESUME_GATE=1/);
  // The two things resuming must not skip: that staging runs THIS release, and the hash comparison before production.
  assert.match(script, /grep -qx 'APP_RELEASE=mahad-\$SHORT'/);
  assert.match(script, /archives on the server unchanged since staging was tested/);
  assert.match(script, /MAHAD_DEPLOY_TARGET=production/);
  // The backup function is used by step 10 too, so it must be defined outside the skipped block.
  assert.ok(script.indexOf('backup() {') < script.indexOf('if [[ "$RESUME_GATE" -eq 0 ]]; then\nsay "6/10'));
  const bash = spawnSync('bash', ['-n', path.join(ROOT, 'deploy', 'release-all.sh')], { encoding: 'utf8' });
  if (!bash.error) assert.equal(bash.status, 0, bash.stderr);
});

test('the server refuses production unless staging runs the same release', () => {
  assert.match(read('deploy-release.sh'), /REFUSED - staging does not run \$R/);
});

test('the settings file is never committed, and its example says what goes in it', () => {
  assert.match(read('.gitignore'), /^deploy\/release\.local\.env$/m);
  const example = read('deploy/release.local.env.example');
  assert.match(example, /^E2E_BASIC_AUTH=user:password$/m, 'a placeholder, not a password');
});

test('every spec that opens its own API client gives it the staging password', () => {
  const helper = read('e2e/helpers/gate.ts');
  assert.match(helper, /request\.newContext\(\{ ignoreHTTPSErrors: true, \.\.\.\(httpCredentials \? \{ httpCredentials \} : \{\}\) \}\)/);
  for (const spec of ['public-smoke', 'payment-flow', 'api-contract']) {
    const source = read(`e2e/tests/${spec}.spec.ts`);
    assert.doesNotMatch(source, /request\.newContext\(\{ ignoreHTTPSErrors: true \}\)/, `${spec} still builds a client with no credentials`);
    assert.match(source, /publicApi\(\)/);
  }
});
