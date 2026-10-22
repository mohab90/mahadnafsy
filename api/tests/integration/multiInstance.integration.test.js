'use strict';
/**
 * Two API instances on one database (deploy/MULTI_INSTANCE.md), each built in
 * its own module registry so nothing in memory is shared between them — as
 * with two processes. A rate limit is enforced once across both (migration
 * 330), a cache or a revoked token dropped in one is dropped in the other
 * (lib/cacheBus.js, migration 331), and an instance that does not hold the
 * reps' WhatsApp says so. Against a real MariaDB; runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-scale-it';
const API = path.join(__dirname, '..', '..');
const PORTS = [3140, 3141, 3142, 3143];
const LIMIT = 6;
// A fresh address per run: its buckets are this run's alone.
const IP = `198.51.100.${Math.floor(Math.random() * 200) + 20}`;
const JTI = `scale-it-${Date.now()}`;

const instances = [];
let admin;

/** Load the API afresh: its own db pool, caches, limiters and cache bus — a second process. */
function freshInstance(env) {
  for (const file of Object.keys(require.cache)) {
    if (file.startsWith(API) && !file.includes(`${path.sep}node_modules${path.sep}`)) delete require.cache[file];
  }
  const saved = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  const instance = {
    db: require('../../lib/db'),
    bus: require('../../lib/cacheBus').bus,
    token: require('../../lib/token'),
    httpApp: require('../../lib/httpApp'),
    env,
    restoreEnv() {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    },
  };
  instances.push(instance);
  return instance;
}

async function listen(instance, port) {
  const app = instance.httpApp.createHttpApp({ pool: instance.db.pool, brandAssetRoot: os.tmpdir() });
  await new Promise((resolve, reject) => {
    instance.server = app.listen(port, '127.0.0.1', resolve);
    instance.server.on('error', reject);
  });
  instance.base = `http://127.0.0.1:${port}`;
  return instance;
}

const ask = (instance, url, headers = {}) => fetch(`${instance.base}${url}`, {
  headers: { 'X-Tenant-Id': TENANT, 'X-Forwarded-For': IP, ...headers },
}).then(async res => ({ status: res.status, body: await res.json().catch(() => null) }));

// Fixed one-minute windows: do not start a burst in the last seconds of one.
async function awayFromWindowEdge() {
  const left = 60000 - (Date.now() % 60000);
  if (left < 5000) await new Promise(resolve => setTimeout(resolve, left + 200));
}

before(async () => {
  if (!ENABLED) return;
  admin = freshInstance({});
  await admin.db.pool.query('DELETE FROM tenants WHERE id=?', [TENANT]);
  await admin.db.pool.query("INSERT INTO tenants (id, slug, name, status) VALUES (?, ?, 'Scale IT', 'active')", [TENANT, TENANT]);
  admin.restoreEnv();
});

after(async () => {
  if (!ENABLED) return;
  for (const instance of instances) {
    if (instance.server) await new Promise(resolve => instance.server.close(resolve));
    instance.bus.stop();
  }
  const origins = instances.map(instance => instance.bus.origin);
  await admin.db.pool.query('DELETE FROM cache_invalidations WHERE origin IN (?)', [origins]).catch(() => {});
  await admin.db.pool.query('DELETE FROM token_blacklist WHERE jti=?', [JTI]).catch(() => {});
  // This run's buckets: the public limiter's key for this address, this window and the last.
  // And the staff limiter's, which the WhatsApp request on the instance holding it passed.
  const { MysqlRateLimitStore } = require('../../lib/mysqlRateLimitStore');
  const hashes = [];
  for (const [name, key] of [
    ['public', `${TENANT}:${IP}:get:/api/push/vapid-public-key`],
    ['privileged', `${TENANT}:anonymous:${IP}:get:/api/staff/whatsapp-web/state`],
  ]) {
    const store = new MysqlRateLimitStore(name);
    store.windowMs = 60000;
    hashes.push(store.bucket(key).hash, store.bucket(key, Date.now() - 60000).hash);
  }
  await admin.db.pool.query('DELETE FROM rate_limit_counters WHERE bucket IN (?)', [hashes]).catch(() => {});
  await admin.db.pool.query('DELETE FROM online_presence WHERE tenant_id=?', [TENANT]).catch(() => {});
  await admin.db.pool.query('DELETE FROM tenants WHERE id=?', [TENANT]).catch(() => {});
  for (const instance of instances) await instance.db.pool.end().catch(() => {});
});

test('in memory each instance counts alone: two of them let twice the limit through', { skip }, async () => {
  process.env.PUBLIC_READ_RATE_LIMIT_PER_MINUTE = String(LIMIT);
  const a = await listen(freshInstance({ MAHAD_MULTI_INSTANCE: undefined, RATE_LIMIT_STORE: undefined }), PORTS[0]);
  a.restoreEnv();
  const b = await listen(freshInstance({ MAHAD_MULTI_INSTANCE: undefined, RATE_LIMIT_STORE: undefined }), PORTS[1]);
  b.restoreEnv();
  await awayFromWindowEdge();
  const statuses = [];
  for (let i = 0; i < LIMIT * 2; i += 1) statuses.push((await ask(i % 2 ? b : a, '/api/push/vapid-public-key', { 'X-Forwarded-For': `${IP}9` })).status);
  assert.deepEqual(statuses, Array(LIMIT * 2).fill(200), 'the bug the shared store fixes');
});

test('with MAHAD_MULTI_INSTANCE the limit is enforced once across both instances', { skip }, async () => {
  process.env.PUBLIC_READ_RATE_LIMIT_PER_MINUTE = String(LIMIT);
  const a = await listen(freshInstance({ MAHAD_MULTI_INSTANCE: '1', MAHAD_WA_WEB: '1' }), PORTS[2]);
  a.restoreEnv();
  const b = await listen(freshInstance({ MAHAD_MULTI_INSTANCE: '1', MAHAD_WA_WEB: '0' }), PORTS[3]);
  b.restoreEnv();
  await awayFromWindowEdge();
  const statuses = [];
  for (let i = 0; i < LIMIT + 3; i += 1) statuses.push((await ask(i % 2 ? b : a, '/api/push/vapid-public-key')).status);
  assert.deepEqual(statuses, [...Array(LIMIT).fill(200), 429, 429, 429]);
  const refused = await ask(a, '/api/push/vapid-public-key');
  assert.equal(refused.body.code, 'RATE_LIMITED');
  delete process.env.PUBLIC_READ_RATE_LIMIT_PER_MINUTE;
});

test('the instance without the reps\' WhatsApp says so; the one with it goes on to sign-in', { skip }, async () => {
  const [, , withWa, withoutWa] = instances.filter(instance => instance.server);
  process.env.MAHAD_WA_WEB = '0';
  const elsewhere = await ask(withoutWa, '/api/staff/whatsapp-web/state');
  assert.equal(elsewhere.status, 503);
  assert.equal(elsewhere.body.code, 'WA_WEB_OTHER_INSTANCE');
  process.env.MAHAD_WA_WEB = '1';
  const here = await ask(withWa, '/api/staff/whatsapp-web/state');
  assert.equal(here.status, 401, 'past the guard, to the ordinary sign-in check');
  delete process.env.MAHAD_WA_WEB;
});

test('a cache and a revoked token dropped in one instance are dropped in the other', { skip }, async () => {
  const a = freshInstance({ CACHE_SYNC: '1', CACHE_SYNC_MS: '60000' });
  a.restoreEnv();
  const b = freshInstance({ CACHE_SYNC: '1', CACHE_SYNC_MS: '60000' });
  b.restoreEnv();
  assert.notEqual(a.bus.origin, b.bus.origin);
  a.bus.start(); b.bus.start();
  await a.bus.pollOnce(); await b.bus.pollOnce();

  const key = `courses:${TENANT}:scale-it`;
  assert.equal(await b.db.cached(key, 60000, async () => 'old'), 'old');
  assert.equal(await b.db.cached(key, 60000, async () => 'new'), 'old', 'held in b');
  a.db.cacheInvalidate('courses:', 'bundles:');
  await a.token.revokeToken(JTI, Date.now() + 60 * 60 * 1000);
  // The publishes are not awaited by their callers; give the inserts a moment.
  for (let i = 0; i < 50; i += 1) {
    const [[row]] = await a.db.pool.query('SELECT COUNT(*) AS n FROM cache_invalidations WHERE origin=?', [a.bus.origin]);
    if (Number(row.n) >= 2) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(b.token.tokenBlacklist.has(JTI), false, 'not yet: b has not polled');
  assert.ok(await b.bus.pollOnce() >= 2);
  assert.equal(await b.db.cached(key, 60000, async () => 'new'), 'new', 'dropped in b by a\'s save');
  assert.equal(b.token.tokenBlacklist.has(JTI), true, 'signed out on a, refused on b');
  assert.equal(await a.bus.pollOnce(), 0, 'a does not re-apply its own');
});

test('the single API shares nothing: no bus, no rows', { skip }, async () => {
  const solo = freshInstance({ CACHE_SYNC: undefined, MAHAD_MULTI_INSTANCE: undefined, MAHAD_ROLE: undefined });
  const started = require('../../lib/cacheBus').startCacheBus();
  solo.restoreEnv();
  assert.equal(started, false);
  assert.equal(await solo.bus.publish('db-cache', null), false);
  const [[row]] = await solo.db.pool.query('SELECT COUNT(*) AS n FROM cache_invalidations WHERE origin=?', [solo.bus.origin]);
  assert.equal(Number(row.n), 0);
});

test('who is online is seen from both instances', { skip }, async () => {
  const a = freshInstance({ MAHAD_MULTI_INSTANCE: '1' });
  const presenceA = require('../../lib/onlineUsers');
  const b = freshInstance({ MAHAD_MULTI_INSTANCE: '1' });
  const presenceB = require('../../lib/onlineUsers');
  await presenceA.setOnlineUser(TENANT, 'u-scale-1', { name: 'منى', email: 'mona@example.test' });
  const seen = await presenceB.listOnlineUsers(TENANT);
  b.restoreEnv(); a.restoreEnv();
  assert.deepEqual(seen.map(user => [user.uid, user.name]), [['u-scale-1', 'منى']]);
});
