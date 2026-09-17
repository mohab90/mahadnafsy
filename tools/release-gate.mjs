#!/usr/bin/env node

/**
 * Everything that has to pass before a release reaches customers, in order,
 * stopping at the first failure.
 *
 * Each stage exists because something got through without it:
 *
 *   local gates      a release shipped whose SQL had never been parsed;
 *   schema           two statements named columns no table has, and one of them
 *                    made the Sheets import answer 500 on every run;
 *   staging deploy   the API had never served a request before production did;
 *   release smoke    every route a release changed, called as the role that uses
 *                    it — 403s and 500s do not show up in a source scan;
 *   paymob smoke     a signed capture, a replay, a short capture, a forged
 *                    signature. This is what caught a payment being taken and
 *                    not recorded;
 *   e2e              the login form had changed shape under a test that was
 *                    still passing.
 *
 * Production is deliberately NOT deployed here. The gate ends by printing the
 * command, so shipping stays a decision somebody makes.
 *
 *   node tools/release-gate.mjs                    # full run
 *   node tools/release-gate.mjs --reuse-client mahad-xxxx   # front end unchanged
 *   node tools/release-gate.mjs --skip-e2e
 */

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const value = name => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : null);

const HOST = process.env.DEPLOY_HOST || 'root@187.55.227.200';
const KEY = process.env.DEPLOY_KEY || '~/.ssh/mahad-local-vps';
const STAGING_API = '/var/www/mahad-staging/api';
const REUSE_CLIENT = value('--reuse-client');
const SKIP_E2E = flag('--skip-e2e');

const commit = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
const release = `mahad-${commit.slice(0, 12)}`;
const ssh = command => `ssh -i ${KEY} -o StrictHostKeyChecking=no ${HOST} ${JSON.stringify(command)}`;

let stage = 0;
const started = Date.now();
function run(name, command, { cwd = root, quiet = false } = {}) {
  stage++;
  process.stdout.write(`\n[${stage}] ${name}\n`);
  try {
    const out = execSync(command, { cwd, encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit', maxBuffer: 64 * 1024 * 1024 });
    if (quiet && out) process.stdout.write(out.split('\n').slice(-6).join('\n') + '\n');
    return out || '';
  } catch (error) {
    if (quiet && error.stdout) process.stdout.write(error.stdout.slice(-4000));
    console.error(`\n✗ ${name} failed — the release stops here.`);
    process.exit(1);
  }
}

console.log(`release gate for ${release}`);
console.log(`  commit ${commit}`);

// ── 1. what can be checked without a server ───────────────────────────────
run('quality gates', 'npm run quality', { quiet: true });
run('unit tests', 'npm run test:unit', { quiet: true });
for (const app of ['api', 'admin', 'client']) run(`lint ${app}`, `npm run lint:${app}`, { quiet: true });
run('route audit', 'npm run audit:routes', { quiet: true });
run('unimported modules', 'npm run audit:orphan-modules', { quiet: true });

// ── 2. artifacts ──────────────────────────────────────────────────────────
const artifacts = path.join(root, 'artifacts', 'releases');
fs.mkdirSync(artifacts, { recursive: true });
if (REUSE_CLIENT) {
  const changed = execSync(`git diff --name-only ${REUSE_CLIENT.replace(/^mahad-/, '')}..HEAD -- client admin shared`, { cwd: root, encoding: 'utf8' }).trim();
  if (changed) {
    console.error(`\n✗ --reuse-client ${REUSE_CLIENT} but the front end changed:\n${changed}`);
    process.exit(1);
  }
  stage++;
  console.log(`\n[${stage}] reusing the front-end archives of ${REUSE_CLIENT} — no client or admin change since`);
  run('api archive', `git archive --format=tar.gz --prefix=mahad-api/ --output=${JSON.stringify(path.join(artifacts, `${release}-api.tgz`))} ${commit}:api`, { quiet: true });
  run('ship to staging', `scp -i ${KEY} -o StrictHostKeyChecking=no ${JSON.stringify(path.join(artifacts, `${release}-api.tgz`))} ${HOST}:/staging/`, { quiet: true });
  run('stage the reused front end', ssh(`cd /staging && cp ${REUSE_CLIENT}-client.tgz ${release}-client.tgz && cp ${REUSE_CLIENT}-admin.tgz ${release}-admin.tgz`), { quiet: true });
} else {
  // prepare-release builds both front ends and refuses an incomplete client
  // archive — see tools/verifyPrerender.mjs.
  run('build and verify artifacts', 'npm run release:prepare', { quiet: true });
  run('ship to staging', `scp -i ${KEY} -o StrictHostKeyChecking=no ${JSON.stringify(path.join(artifacts, `${release}-*.tgz`))} ${HOST}:/staging/`, { quiet: true });
}

// ── 3. staging, then everything that needs a running server ───────────────
run('deploy to staging only', ssh(
  `sed '/^echo "staging is healthy; continuing to production"/,$d' /root/deploy-release.sh > /tmp/gate-staging.sh` +
  ` && bash /tmp/gate-staging.sh ${release}; code=$?; rm -f /tmp/gate-staging.sh; exit $code`));

// The whole API, not just this release: the server has no git checkout to diff
// against, and a statement that breaks is worth catching wherever it lives.
// pipeline.js is ignored — a file left behind by an old deploy, in no release.
run('schema: every statement against the database', ssh(`cd ${STAGING_API} && node tools/explain-sql.cjs --ignore pipeline.js`), { quiet: true });
run('release smoke', ssh(`cd ${STAGING_API} && API_BASE_URL=http://127.0.0.1:3002 node tools/release-smoke.cjs`), { quiet: true });
run('paymob smoke', ssh(`cd ${STAGING_API} && node tools/paymob-staging-smoke.cjs ${STAGING_API}/.env`), { quiet: true });

// ── 4. the browser, against staging ───────────────────────────────────────
if (!SKIP_E2E) {
  stage++;
  console.log(`\n[${stage}] end-to-end against staging`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'release-gate-'));
  const adminDir = path.join(work, 'admin');
  const clientDir = path.join(work, 'client');
  fs.mkdirSync(adminDir); fs.mkdirSync(clientDir);
  execSync(`scp -i ${KEY} -o StrictHostKeyChecking=no ${HOST}:/staging/${release}-admin.tgz ${HOST}:/staging/${release}-client.tgz ${JSON.stringify(work)}`, { stdio: 'inherit' });
  execSync(`tar --force-local -xzf ${JSON.stringify(path.join(work, `${release}-admin.tgz`))} -C ${JSON.stringify(adminDir)}`);
  execSync(`tar --force-local -xzf ${JSON.stringify(path.join(work, `${release}-client.tgz`))} -C ${JSON.stringify(clientDir)}`);

  const tunnel = spawn('ssh', ['-i', KEY.replace('~', os.homedir()), '-o', 'StrictHostKeyChecking=no', '-o', 'ExitOnForwardFailure=yes', '-N', '-L', '13002:127.0.0.1:3002', HOST], { stdio: 'ignore' });
  const proxy = spawn(process.execPath, [path.join(root, 'tools', 'e2e-staging-proxy.cjs'), adminDir, clientDir], { stdio: 'ignore' });
  const stop = () => { tunnel.kill(); proxy.kill(); };
  process.on('exit', stop);

  try {
    execSync('node -e "setTimeout(()=>{},4000)"');
    execSync('npx playwright test --reporter=line', {
      cwd: path.join(root, 'e2e'),
      stdio: 'inherit',
      env: { ...process.env, BASE_URL: 'http://127.0.0.1:5180', ADMIN_BASE_URL: 'http://127.0.0.1:4000', API_BASE_URL: 'http://127.0.0.1:5180' },
    });
  } catch {
    stop();
    console.error('\n✗ end-to-end failed — the release stops here.');
    process.exit(1);
  }
  stop();
  fs.rmSync(work, { recursive: true, force: true });
}

// ── 5. hand it over ───────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(72)}`);
console.log(`${release} passed every stage in ${Math.round((Date.now() - started) / 1000)}s. It is live on staging.`);
console.log('\nProduction is a decision, not a stage. When you want it:');
console.log(`\n  ssh -i ${KEY} ${HOST} "bash /root/deploy-release.sh ${release}"\n`);
