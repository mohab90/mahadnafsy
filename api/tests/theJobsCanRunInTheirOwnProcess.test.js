'use strict';

// One process served HTTP, held the reps' WhatsApp sessions and ran ~20
// periodic jobs (21 Oct 2026). MAHAD_ROLE=web|worker|all splits the jobs into
// worker.js when the server opts in; unset, nothing changes.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const test = require('node:test');
const { processRole, servesHttp, runsJobs } = require('../lib/processRole');

const root = path.join(__dirname, '..');
const childEnv = extra => ({
  PATH: process.env.PATH,
  NODE_ENV: 'test',
  // A port nothing listens on: the process must come up without a database.
  DB_HOST: '127.0.0.1', DB_PORT: '1', DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'n',
  JWT_SECRET: 'x'.repeat(64),
  // server.js and worker.js load api/.env themselves; a machine whose .env asks for a CA file must not decide this test
  DB_SSL_MODE: 'disabled',
  ...extra,
});

test('the role defaults to everything in one process, and a typo keeps it that way', () => {
  assert.equal(processRole({}), 'all');
  assert.equal(processRole({ MAHAD_ROLE: ' Web ' }), 'web');
  assert.equal(processRole({ MAHAD_ROLE: 'worker' }), 'worker');
  assert.equal(processRole({ MAHAD_ROLE: 'wrker' }), 'all');
  assert.deepEqual(['all', 'web', 'worker'].map(r => [servesHttp(r), runsJobs(r)]),
    [[true, true], [true, false], [false, true]]);
});

test('server.js starts the jobs only when it is not the web half', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const listen = server.slice(server.indexOf('app.listen('));
  assert.match(listen, /if \(role === 'all'\) \{\s*startBackgroundScheduler\(/);
  // The WhatsApp sessions stay with HTTP: the routes send through them in memory.
  assert.ok(listen.indexOf("require('./lib/whatsappWeb').startWhatsappWeb()") > listen.indexOf("} else logger.info('[jobs] MAHAD_ROLE=web"));
});

test('server.js refuses to be the worker', () => {
  const run = spawnSync(process.execPath, ['server.js'], { cwd: root, env: childEnv({ MAHAD_ROLE: 'worker' }), encoding: 'utf8', timeout: 15000 });
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stdout + run.stderr, /MAHAD_ROLE=worker is started with worker\.js/);
});

test('worker.js stays up with no HTTP server to hold it open', async () => {
  const child = spawn(process.execPath, ['worker.js'], { cwd: root, env: childEnv({}), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  let exited = null;
  child.on('exit', code => { exited = code; });
  await new Promise(resolve => setTimeout(resolve, 2500));
  const alive = exited === null;
  child.kill('SIGKILL');
  assert.ok(alive, `worker exited early (${exited}): ${out}`);
  assert.match(out, /\[worker\] background jobs running/);
  assert.doesNotMatch(out, /running on port/);
});
