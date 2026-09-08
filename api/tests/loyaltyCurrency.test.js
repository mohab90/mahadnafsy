'use strict';
/**
 * Loyalty points are denominated in EGP — the rate is LOYALTY_EGP_PER_POINT.
 * awardPointsForPayment divided the payment's own amount by it without ever
 * reading the payment's currency, so a 500 SAR order (~6,500 EGP) earned five
 * points where the same purchase made in Egypt earned sixty-five. Run: npm run test:unit
 */
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../lib/db');

// The ledger writes go through pool.getConnection; loyalty holds this exact
// object, so replacing the methods here is enough to keep the test off a DB.
function stubPool() {
  const writes = [];
  pool.query = async () => [[{ tenant_id: 'tenant-a' }]];
  pool.getConnection = async () => ({
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql, params) {
      if (sql.includes('FROM subscribers')) {
        return [[{ id: 'S1', tenant_id: 'tenant-a', loyalty_points: 0 }]];
      }
      writes.push({ sql, params });
      return [{}];
    },
  });
  return writes;
}

const { awardPointsForPayment } = require('../lib/loyalty');

function pointsWritten(writes) {
  const update = writes.find(w => w.sql.includes('UPDATE subscribers SET loyalty_points'));
  return update ? update.params[0] : null;
}

test('a payment already priced in EGP earns points on that price, not on its foreign amount', async () => {
  const writes = stubPool();
  await awardPointsForPayment({
    id: 'PAY-SAR-1', subscriberId: 'S1', tenantId: 'tenant-a',
    amount: 500, currency: 'SAR', amountEgp: 6500,
  });
  assert.equal(pointsWritten(writes), 65, '6,500 EGP at 100 EGP per point');
});

test('an EGP payment is unaffected', async () => {
  const writes = stubPool();
  await awardPointsForPayment({
    id: 'PAY-EGP-1', subscriberId: 'S1', tenantId: 'tenant-a',
    amount: 500, currency: 'EGP',
  });
  assert.equal(pointsWritten(writes), 5);
});

test('a foreign payment with no usable rate awards nothing rather than a fraction', async () => {
  const writes = stubPool();
  await assert.rejects(
    awardPointsForPayment({
      id: 'PAY-SAR-2', subscriberId: 'S1', tenantId: 'tenant-a',
      amount: 500, currency: 'SAR',
    }),
    /snapshot unavailable|rate unavailable/i
  );
  assert.equal(pointsWritten(writes), null, 'nothing is written when the amount cannot be trusted');
});

test('the paymob callback hands loyalty the currency it recorded on the payment', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'public-orders.js'), 'utf8');
  const call = source.slice(source.indexOf('awardPointsForPayment({'));
  const args = call.slice(0, call.indexOf('})'));
  assert.match(args, /currency: order\.currency/);
  assert.match(args, /tenantId/);
});
