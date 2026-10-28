'use strict';

// What several web instances share through the database instead of memory
// (deploy/MULTI_INSTANCE.md): the rate-limit counts (lib/mysqlRateLimitStore.js)
// and cache invalidations (lib/cacheBus.js) — and that the single API, with
// nothing switched on, still counts and caches in its own memory.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-shared-state-secret-0123456789-abcdefgh';

const { rateLimitBackend } = require('../lib/rateLimitStore');
const { MysqlRateLimitStore } = require('../lib/mysqlRateLimitStore');
const { createCacheBus } = require('../lib/cacheBus');
const { sharesCaches, multiInstance } = require('../lib/processRole');

test('the single API counts in memory; several instances count in the database; Redis wins', () => {
  assert.equal(rateLimitBackend({}), 'memory');
  assert.equal(rateLimitBackend({ MAHAD_MULTI_INSTANCE: '1' }), 'mysql');
  assert.equal(rateLimitBackend({ MAHAD_MULTI_INSTANCE: '1', RATE_LIMIT_STORE: 'memory' }), 'memory');
  assert.equal(rateLimitBackend({ RATE_LIMIT_STORE: 'mysql' }), 'mysql');
  assert.equal(rateLimitBackend({ MAHAD_MULTI_INSTANCE: '1', RATE_LIMIT_REDIS_ENABLED: 'true' }), 'redis');
  assert.equal(multiInstance({ MAHAD_MULTI_INSTANCE: 'yes' }), false, 'only 1 switches it on');
});

test('caches are shared only when another process reads the same database', () => {
  assert.equal(sharesCaches({}), false, 'the single API as before');
  assert.equal(sharesCaches({ MAHAD_ROLE: 'web' }), true, 'the worker beside it');
  assert.equal(sharesCaches({ MAHAD_ROLE: 'worker' }), true);
  assert.equal(sharesCaches({ MAHAD_MULTI_INSTANCE: '1' }), true);
  assert.equal(sharesCaches({ MAHAD_MULTI_INSTANCE: '1', CACHE_SYNC: '0' }), false);
  assert.equal(sharesCaches({ CACHE_SYNC: '1' }), true);
});

function counterDb() {
  const rows = new Map();
  const calls = [];
  return {
    calls, rows,
    async query(sql, params) {
      calls.push(sql.replace(/\s+/g, ' ').trim());
      if (/^INSERT INTO rate_limit_counters/.test(sql)) {
        const [bucket] = params;
        if (!rows.has(bucket)) { rows.set(bucket, 1); return [{ affectedRows: 1, insertId: 0 }]; }
        rows.set(bucket, rows.get(bucket) + 1);
        return [{ affectedRows: 2, insertId: rows.get(bucket) }];
      }
      if (/^UPDATE rate_limit_counters/.test(sql)) { rows.set(params[0], Math.max(1, rows.get(params[0]) || 0) - 1); return [{}]; }
      if (/^SELECT hits/.test(sql)) return [[rows.has(params[0]) ? { hits: rows.get(params[0]) } : undefined].filter(Boolean)];
      if (/^DELETE/.test(sql)) { rows.delete(params[0]); return [{}]; }
      throw new Error(`unexpected ${sql}`);
    },
  };
}

test('one upsert per request; the count comes back from it; the window ends on the clock', async () => {
  const db = counterDb();
  let now = 120_000 + 5_000;
  const store = new MysqlRateLimitStore('login-ip', { db: () => db, now: () => now });
  store.init({ windowMs: 60_000 });
  const first = await store.increment('k');
  const second = await store.increment('k');
  assert.equal(first.totalHits, 1);
  assert.equal(second.totalHits, 2);
  assert.equal(second.resetTime.getTime(), 180_000);
  assert.equal(db.calls.filter(sql => sql.startsWith('INSERT')).length, 2);
  assert.match(db.calls[0], /ON DUPLICATE KEY UPDATE hits = LAST_INSERT_ID\(hits \+ 1\)/);
  await store.decrement('k');
  assert.equal((await store.get('k')).totalHits, 1, 'a successful login is not counted (skipSuccessfulRequests)');
  assert.equal((await store.increment('other')).totalHits, 1, 'keys are counted apart');
  now = 180_000;
  assert.equal((await store.increment('k')).totalHits, 1, 'the next window starts again');
  await store.resetKey('k');
  assert.equal(await store.get('k'), undefined);
  store.shutdown();
});

test('another limiter with the same key has its own bucket', () => {
  const a = new MysqlRateLimitStore('otp-ip', { db: () => null, now: () => 0 });
  const b = new MysqlRateLimitStore('register', { db: () => null, now: () => 0 });
  a.init({ windowMs: 60_000 }); b.init({ windowMs: 60_000 });
  assert.notEqual(a.bucket('k').hash, b.bucket('k').hash);
  assert.equal(a.localKeys, false, 'tells express-rate-limit the counts are shared');
  a.shutdown(); b.shutdown();
});

test('with the database unreachable it counts in this process instead of refusing everyone', async () => {
  const store = new MysqlRateLimitStore('public', { db: () => ({ query: async () => { throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' }); } }) });
  store.init({ windowMs: 60_000 });
  assert.equal((await store.increment('k')).totalHits, 1);
  assert.equal((await store.increment('k')).totalHits, 2);
  store.shutdown();
});

function busDb() {
  const rows = [];
  let id = 0;
  return {
    rows,
    async query(sql, params) {
      if (/^INSERT INTO cache_invalidations/.test(sql)) {
        id += 1;
        rows.push({ id, channel: params[0], arg: params[1], origin: params[2], created_at: new Date() });
        return [{ insertId: id }];
      }
      if (/MAX\(id\)/.test(sql)) return [[{ id: rows.reduce((max, row) => Math.max(max, row.id), 0) }]];
      if (/^SELECT id, channel/.test(sql)) return [rows.filter(row => row.id > params[0]).sort((x, y) => x.id - y.id)];
      if (/^DELETE/.test(sql)) return [{ affectedRows: 0 }];
      throw new Error(`unexpected ${sql}`);
    },
  };
}

const quiet = { info() {}, warn() {} };

test('an invalidation in one process is applied in the other, once, and not echoed back', async () => {
  const db = busDb();
  const a = createCacheBus({ db: () => db, origin: 'a', logger: quiet, pollMs: 60_000 });
  const b = createCacheBus({ db: () => db, origin: 'b', logger: quiet, pollMs: 60_000 });
  const droppedA = [];
  const droppedB = [];
  const priceA = a.shared('prices', tenantId => droppedA.push(tenantId || 'all'));
  b.shared('prices', tenantId => droppedB.push(tenantId || 'all'));
  a.start(); b.start();
  await a.pollOnce(); await b.pollOnce();

  priceA('tenant-1');
  priceA();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(droppedA, ['tenant-1', 'all'], 'here at once');
  assert.deepEqual(droppedB, [], 'there on the next poll');
  assert.equal(await b.pollOnce(), 2);
  assert.deepEqual(droppedB, ['tenant-1', 'all']);
  assert.equal(await b.pollOnce(), 0, 'not applied twice');
  assert.equal(await a.pollOnce(), 0, 'its own are not applied again');
  a.stop(); b.stop();
});

test('a row that becomes visible after a later one is still applied', async () => {
  const db = busDb();
  const b = createCacheBus({ db: () => db, origin: 'b', logger: quiet, pollMs: 60_000 });
  const seen = [];
  b.on('x', arg => seen.push(arg));
  await b.pollOnce();
  db.rows.push({ id: 2, channel: 'x', arg: 'second', origin: 'a' });
  await b.pollOnce();
  // Row 1 committed late: it shows up only now, behind the last id read.
  db.rows.push({ id: 1, channel: 'x', arg: 'first', origin: 'a' });
  await b.pollOnce();
  assert.deepEqual(seen, ['second', 'first']);
});

test('until it is started (the single API) nothing is written', async () => {
  const db = busDb();
  const bus = createCacheBus({ db: () => db, origin: 'solo', logger: quiet });
  const local = [];
  const drop = bus.shared('brand', tenantId => local.push(tenantId));
  drop('tenant-1');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(local, ['tenant-1']);
  assert.equal(db.rows.length, 0);
});

test('a saved offer or exchange rate drops the public price list at once', async () => {
  const dbModule = require('../lib/db');
  const { setTenantSetting } = require('../lib/tenantSettings');
  const original = dbModule.cacheInvalidate;
  const dropped = [];
  dbModule.cacheInvalidate = (...prefixes) => dropped.push(...prefixes);
  try {
    const db = { query: async () => [{}] };
    await setTenantSetting('discounts', [], { tenantId: 'tenant-a', db });
    await setTenantSetting('content', {}, { tenantId: 'tenant-a', db });
    await setTenantSetting('crm_settings', {}, { tenantId: 'tenant-a', db });
  } finally {
    dbModule.cacheInvalidate = original;
  }
  assert.deepEqual(dropped, ['public-prices:tenant-a', 'public-prices:tenant-a']);
});
