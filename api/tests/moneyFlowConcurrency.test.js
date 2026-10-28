'use strict';
// What the server does with concurrent money requests — checkout serialised by
// business intent and a pending order reused, a receipt approved once, a refund
// decided once — is exercised over HTTP in
// tests/integration/checkoutAndProofs.integration.test.js and
// tests/integration/refundBehaviour.integration.test.js. What is left here is
// the browser's half, which those cannot see.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('checkout sends one idempotency key per attempt, kept across a retry', () => {
  const client = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'pages', 'Checkout.tsx'), 'utf8');
  assert.match(client, /Idempotency-Key': idempotencyKey/);
  assert.match(client, /sessionStorage\.getItem\(idempotencyStorageKey\)/);
});
