'use strict';

// A signed «paid» callback whose crediting fails must not be answered 200: that
// tells Paymob the callback was delivered, so it is never sent again and the
// order stays unpaid while the customer's money has been taken.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const path = require('path');

const SECRET = 'paymob-test-hmac-secret';
const stub = (rel, exports) => {
  const resolved = require.resolve(path.join(__dirname, rel));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};
stub('../lib/saasSettings', {
  ...require('../lib/saasSettings'),
  getPaymentGatewaySettings: async () => ({ active_provider: 'paymob', paymob: { enabled: true, hmac_secret: SECRET } }),
});
let dbDown = true;
stub('../lib/db', {
  ...require('../lib/db'),
  pool: {
    async getConnection() { if (dbDown) throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }); return null; },
    async query() { throw new Error('connect ECONNREFUSED'); },
  },
});
const { buildPaymobHmacPayload } = require('../lib/paymobHmac');
const router = require('../routes/public-orders');

const handler = router.stack.find(layer => layer.route?.path === '/api/webhooks/paymob').route.stack.at(-1).handle;
const call = async body => {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  await handler({ body, query: {}, tenantId: 'tenant-default', headers: {} }, res);
  return res;
};
const signed = obj => ({ obj, hmac: crypto.createHmac('sha512', SECRET).update(buildPaymobHmacPayload(obj)).digest('hex') });
const paidCallback = {
  id: 9001, success: true, amount_cents: 150000, currency: 'EGP', pending: false, is_refunded: false,
  order: { id: 77, merchant_order_id: 'order-abc' }, source_data: { type: 'card', pan: '1234', sub_type: 'Visa' },
  created_at: '2026-10-04T10:00:00', error_occured: false, has_parent_transaction: false, integration_id: 1,
  is_3d_secure: true, is_auth: false, is_capture: false, is_standalone_payment: true, is_voided: false, owner: 1,
};

test('a paid callback that could not be credited is answered with an error, so Paymob sends it again', async () => {
  const res = await call(signed(paidCallback));
  assert.strictEqual(res.statusCode, 500);
  assert.deepStrictEqual(res.body, { ok: false, reason: 'processing_error' });
});

test('a forged callback is still 200: sending it again changes nothing', async () => {
  const res = await call({ obj: paidCallback, hmac: 'f'.repeat(128) });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.reason, 'invalid_signature');
});
