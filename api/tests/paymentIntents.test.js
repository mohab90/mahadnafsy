'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { idempotencyHash } = require('../lib/paymentIntents');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

test('payment intent idempotency is tenant/provider/order scoped and irreversible', () => {
  const input = { tenantId: 'tenant-a', orderId: 'order-1', provider: 'manual', key: 'retry-key' };
  const first = idempotencyHash(input);
  assert.equal(first, idempotencyHash(input));
  assert.equal(first.length, 64);
  assert.notEqual(first, idempotencyHash({ ...input, tenantId: 'tenant-b' }));
  assert.doesNotMatch(first, /retry-key/);
});

test('manual proof lifecycle binds order, intent, attempt, payment and journal transactionally', () => {
  const proof = read('routes/payment-proofs.js');
  const intentRoute = read('routes/payment-intents.js');
  assert.match(intentRoute, /provider !== 'manual'/);
  assert.match(intentRoute, /PAYMOB_DISABLED/);
  assert.match(proof, /getOrCreatePaymentIntent\(conn/);
  assert.match(proof, /createPaymentAttempt\(conn/);
  assert.match(proof, /settlePaymentAttempt\(conn/);
  assert.match(proof, /postPaymentJournal/);
  assert.match(proof, /grantCourseSelections/);
});

test('payment intent schema enforces active-order and retry idempotency uniqueness', () => {
  const migration = read('migrations/172_v25_payment_intents.sql');
  assert.match(migration, /uq_payment_intent_idempotency/);
  assert.match(migration, /uq_payment_intent_active_order/);
  assert.match(migration, /uq_payment_attempt_proof/);
  assert.match(migration, /payment_intent_id/);
  assert.match(migration, /payment_attempt_id/);
});
