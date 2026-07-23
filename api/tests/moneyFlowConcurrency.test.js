'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('checkout serializes the same business intent and reuses a recent pending order', () => {
  const route = read('routes/lead-capture-crm.js');
  const client = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'pages', 'Checkout.tsx'), 'utf8');
  assert.match(route, /createHash\('sha256'\)[\s\S]*SELECT GET_LOCK\(\?,5\) AS acquired/);
  assert.match(route, /status='pending'[\s\S]*INTERVAL 24 HOUR[\s\S]*FOR UPDATE/);
  assert.match(route, /SELECT RELEASE_LOCK\(\?\)/);
  assert.match(client, /Idempotency-Key': idempotencyKey/);
  assert.match(client, /sessionStorage\.getItem\(idempotencyStorageKey\)/);
});

test('proof approval is row locked and cannot create a second payment', () => {
  const route = read('routes/payment-proofs.js');
  assert.match(route, /WHERE pp\.id=\? AND pp\.tenant_id=\? LIMIT 1 FOR UPDATE/);
  assert.match(route, /proof\.status !== 'PENDING'/);
  assert.match(route, /const payId = `proof-\$\{proof\.id\}`/);
  assert.match(route, /postPaymentJournal\([\s\S]*conn/);
  assert.match(route, /await conn\.commit\(\)/);
});

test('refund resolution locks one tenant request and posts a reversal in the same transaction', () => {
  // Was routes/admin-utils.js (the inline duplicate, since removed — Phase
  // 1.d unified both copies behind lib/refunds.js#applyRefundReversal,
  // called from the route the frontend actually uses).
  const route = read('routes/finance.js');
  const refunds = read('lib/refunds.js');
  assert.match(route, /FROM refund_requests rr[\s\S]*FOR UPDATE/);
  assert.match(route, /applyRefundReversal\(/);
  assert.match(refunds, /UPDATE payments SET status='refunded'/);
  assert.match(refunds, /await assertWritable\(/);
  assert.match(refunds, /postJournalEntry\(\s*\n?\s*'refund'/);
  assert.match(route, /await conn\.commit\(\)/);
});
