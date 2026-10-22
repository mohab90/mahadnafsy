'use strict';

// Two or more web processes behind nginx (deploy/MULTI_INSTANCE.md): what each
// process must do differently from the single API it has always been —
// drain on SIGTERM so nginx moves to the other instance, hold the reps'
// WhatsApp in exactly one of them, and run the route timers once.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-multi-instance-secret-0123456789-abcdefgh';

const lifecycle = require('../lib/processLifecycle');

function fakeServer({ closes = true } = {}) {
  const calls = [];
  return {
    calls,
    close(cb) { calls.push('close'); if (closes) setTimeout(cb, 5); },
    closeIdleConnections() { calls.push('idle'); },
    closeAllConnections() { calls.push('all'); },
  };
}

function start({ closes, drainMs = 10000 } = {}) {
  lifecycle._testing.reset();
  const proc = new EventEmitter();
  const exits = [];
  let ended = 0;
  const pool = { end: async () => { ended += 1; } };
  const life = lifecycle.registerProcessLifecycle({
    logger: { info() {}, warn() {}, error() {} }, pool, proc, exit: code => exits.push(code), drainMs,
  });
  const server = fakeServer({ closes });
  life.setHttpServer(server);
  return { proc, exits, server, ended: () => ended };
}

test('SIGTERM stops accepting, sweeps idle keep-alive sockets, then closes the pool and exits', async () => {
  const { proc, exits, server, ended } = start();
  assert.equal(lifecycle.isDraining(), false);
  proc.emit('SIGTERM');
  assert.equal(lifecycle.isDraining(), true, 'answers from now on close their connection');
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(server.calls[0], 'close', 'the listener closes first');
  assert.ok(server.calls.includes('idle'), 'then the idle keep-alive sockets go');
  assert.equal(server.calls.includes('all'), false, 'nothing in flight was cut');
  assert.equal(ended(), 1);
  assert.deepEqual(exits, [0]);
});

test('a request that outlives the cap is cut and the process still exits', async () => {
  const { proc, exits, server } = start({ closes: false, drainMs: 30 });
  proc.emit('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.ok(server.calls.includes('all'));
  assert.deepEqual(exits, [0]);
});

test('the cap is read from SHUTDOWN_DRAIN_MS within sane bounds', () => {
  assert.equal(lifecycle.drainCapMs({}), 10000);
  assert.equal(lifecycle.drainCapMs({ SHUTDOWN_DRAIN_MS: '15000' }), 15000);
  assert.equal(lifecycle.drainCapMs({ SHUTDOWN_DRAIN_MS: '99' }), 10000);
  assert.equal(lifecycle.drainCapMs({ SHUTDOWN_DRAIN_MS: '600000' }), 25000, 'stays inside TimeoutStopSec=30s');
});

function response() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('while draining, answers close their connection and health says draining', () => {
  const { drainingAnswers } = require('../lib/httpApp');
  lifecycle._testing.reset();
  let res = response(); let passed = false;
  drainingAnswers({ path: '/api/health' }, res, () => { passed = true; });
  assert.equal(passed, true);
  assert.equal(res.headers.connection, undefined);

  const { proc } = start({ closes: false, drainMs: 60000 });
  proc.emit('SIGTERM');
  res = response(); passed = false;
  drainingAnswers({ path: '/api/health' }, res, () => { passed = true; });
  assert.equal(passed, false);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { status: 'draining' });
  assert.equal(res.headers.connection, 'close');
  res = response(); passed = false;
  drainingAnswers({ path: '/api/courses' }, res, () => { passed = true; });
  assert.equal(passed, true, 'a request already on its way is still served');
  assert.equal(res.headers.connection, 'close');
  lifecycle._testing.reset();
});

test('MAHAD_WA_WEB names the one instance that holds the reps\' WhatsApp', () => {
  const wa = require('../lib/whatsappWeb');
  assert.equal(wa.waWebMode({}), 'auto', 'unset: the single API as before');
  assert.equal(wa.waWebMode({ MAHAD_WA_WEB: '1' }), 'on');
  assert.equal(wa.waWebMode({ MAHAD_WA_WEB: '0' }), 'off');
});

test('a WhatsApp route on an instance without the sessions says so instead of pretending', () => {
  const wa = require('../lib/whatsappWeb');
  const saved = process.env.MAHAD_WA_WEB;
  try {
    process.env.MAHAD_WA_WEB = '0';
    const res = response(); let passed = false;
    wa.instanceGuard({}, res, () => { passed = true; });
    assert.equal(passed, false);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'WA_WEB_OTHER_INSTANCE');
    assert.match(res.body.error, /نسخة تانية/);
    for (const value of ['1', undefined]) {
      if (value === undefined) delete process.env.MAHAD_WA_WEB; else process.env.MAHAD_WA_WEB = value;
      let through = false;
      wa.instanceGuard({}, response(), () => { through = true; });
      assert.equal(through, true);
    }
  } finally {
    if (saved === undefined) delete process.env.MAHAD_WA_WEB; else process.env.MAHAD_WA_WEB = saved;
  }
});

test('the route timers start once, from the process that owns the jobs — not on require', () => {
  const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const shared = read('routes/misc/_shared.js');
  const support = read('routes/support.js');
  assert.doesNotMatch(shared, /^schedule\w+\(\);$/m, 'no timer starts when the routes load');
  assert.doesNotMatch(shared, /^require\('[^']+followUpDigest'\)\.scheduleFollowUpDigest\(\);$/m);
  assert.doesNotMatch(support, /^scheduleSlaSweep\(\);$/m);
  assert.match(shared, /function startSharedRouteJobs\(\)/);
  const server = read('server.js');
  const allOnly = server.slice(server.indexOf("if (role === 'all') {"), server.indexOf('} else logger.info'));
  assert.match(allOnly, /startRouteJobs\(/, 'MAHAD_ROLE=web instances leave them to the job owner');
  assert.match(read('worker.js'), /require\('\.\/lib\/routeJobs'\)\.startRouteJobs\(/);
});
