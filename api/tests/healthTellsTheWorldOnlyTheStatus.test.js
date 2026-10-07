'use strict';

// NEW-28 of the external audit (7 Oct 2026): the public /api/health named the
// database and Redis. The world reads the status; the server itself — the deploy
// script asks from 127.0.0.1 — reads the parts.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-health-secret-0123456789-abcdefghijklmnopqrs';

let dbUp = true;
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/db', {
  pool: { query: async () => { if (!dbUp) throw new Error('down'); return [[{ 1: 1 }]]; } },
  cached: async (_k, _t, fn) => fn(), cacheInvalidate() {}, requireDb: (_q, _s, n) => n(), isDbDown: () => false,
  getStaffIdByEmail: async () => null,
});
stub('../lib/rateLimitStore', { redisHealth: async () => ({ enabled: false, ok: false }) });

const router = require('../routes/core/intake');
const handler = router.stack.find(l => l.route && l.route.path === '/api/health').route.stack[0].handle;
async function ask(ip) {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ ip }, res);
  return res;
}

test('a visitor reads the status and nothing behind it', async () => {
  dbUp = true;
  const res = await ask('197.0.0.9');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'ok', 'the deploy check greps "status":"ok"');
  assert.equal(res.body.db, undefined);
  assert.equal(res.body.redis, undefined);
  dbUp = false;
  const down = await ask('197.0.0.9');
  assert.equal(down.statusCode, 503);
  assert.deepEqual(down.body, { status: 'error' });
});

test('the server itself reads the parts', async () => {
  dbUp = true;
  const res = await ask('127.0.0.1');
  assert.equal(res.body.db, 'connected');
  assert.deepEqual(res.body.redis, { enabled: false, ok: false });
});
