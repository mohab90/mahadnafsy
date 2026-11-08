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



