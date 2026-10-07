'use strict';

// POST /api/orders/reserve is public and the Paymob gateway is live. A course
// or a track is checked against the catalogue; a consultation had no catalogue
// price, so it went in at whatever figure the request named, and the webhook
// then confirmed the booking for whatever was paid. And the standalone page's
// payments were filed as consultations, so each one would have opened an empty
// consultation request. Raised by an outside review on 7 Oct 2026; no order
// has ever come through this route on production.

const test = require('node:test');
const assert = require('node:assert/strict');

const db = {
  calls: [],
  script: [],
  async query(sql, params = []) {
    const flat = String(sql).replace(/\s+/g, ' ').trim();
    db.calls.push({ sql: flat, params });
    for (const [pattern, answer] of db.script) if (pattern.test(flat)) return answer;
    return /^(INSERT|UPDATE)/i.test(flat) ? [{ affectedRows: 1 }] : [[]];
  },
  reset(script = []) { db.calls = []; db.script = script; },
};
const conn = { query: (...a) => db.query(...a), async beginTransaction() {}, async commit() {}, async rollback() {}, release() {} };
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/db', {
  pool: { query: (...a) => db.query(...a), getConnection: async () => conn },
  cached: async (_key, _ttl, fn) => fn(), cacheInvalidate() {}, requireDb: (_q, _s, next) => next(), isDbDown: () => false,
});
const saas = require('../lib/saasSettings');
stub('../lib/saasSettings', { ...saas, getPaymentGatewaySettings: async () => ({}), isPaymobActive: () => true });

const router = require('../routes/public-orders');
const layer = router.stack.find(item => item.route && item.route.path === '/api/orders/reserve');
const reserve = layer.route.stack[layer.route.stack.length - 1].handle;
async function call(body, tenantId = 'tenant-default') {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  await reserve({ body, tenantId, headers: {}, ip: '127.0.0.1' }, res);
  return res;
}
const inserted = () => db.calls.find(call => /^INSERT INTO orders/.test(call.sql));

test('a consultation cannot be reserved at a price the caller names', async () => {
  db.reset();
  const res = await call({ orderId: 'o-1', type: 'consultation', amount: 1, consultationData: { therapistId: 't-1', sessionDate: '2026-10-10' } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'ORDER_TYPE_NOT_RESERVABLE');
  assert.equal(inserted(), undefined, 'nothing is written');
});

test('a standalone payment is filed as OTHER, carrying no booking', async () => {
  db.reset();
  const res = await call({ orderId: 'o-2', type: 'standalone_payment', amount: 750, consultationData: { therapistId: 't-1' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const insert = inserted();
  assert.equal(insert.params[3], 'OTHER', 'no consultation is opened when it is paid');
  assert.doesNotMatch(insert.params[10], /consultationData|therapistId/);
});

test('an order id that belongs to another tenant is not taken over', async () => {
  db.reset([[/^SELECT status, tenant_id FROM orders WHERE id=\?/, [[{ status: 'pending', tenant_id: 'tenant-other' }]]]]);
  const res = await call({ orderId: 'o-3', type: 'standalone_payment', amount: 100 });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'ORDER_ID_TAKEN');
  assert.equal(inserted(), undefined);
});
