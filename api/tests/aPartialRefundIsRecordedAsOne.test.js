'use strict';

// Giving a customer part of their money back.
//
// The refund path flipped the payment to 'refunded' and took the enrolment
// away with it, so anything short of the full amount had to be refused — and
// it was, with «Partial refunds are not enabled». The desk asked for it, so it
// is recorded the way money leaving is recorded everywhere else in this
// system: as its own payment row, negative, against the box it left from.
//
// That shape is what makes every figure right without touching a single
// reader: the client's paid total, the vault, the branch P&L and the reports
// all sum the same column they already sum.
//
// A partial refund leaves the enrolment alone — the customer has still paid
// for part of it — and reduces the salesperson's commission in proportion. A
// full refund keeps its old behaviour exactly: status 'refunded', entitlement
// revoked, commission and instructor fee cancelled.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'lib', 'refunds.js'), 'utf8');

test('a partial amount is accepted', () => {
  assert.ok(!SOURCE.includes('Partial refunds are not enabled'),
    'the refusal must be gone now that the path exists');
  assert.match(SOURCE, /isPartial/, 'the two cases have to be told apart');
  assert.match(SOURCE, /refundAmount[\s\S]{0,200}pay\.amount/,
    'the requested amount is still measured against what was actually paid');
});

test('more than was paid is still refused, and so is nothing', () => {
  const guard = SOURCE.slice(SOURCE.indexOf('const requestedAmount'), SOURCE.indexOf('const requestedAmount') + 700);
  assert.match(guard, /requestedAmount <= 0/, 'zero or negative is not a refund');
  assert.match(guard, /requestedAmount - paidAmount > 0\.01/,
    'the institute cannot give back more than it took');
});

test('the money going out is a row of its own, against the same box', () => {
  const partial = SOURCE.slice(SOURCE.indexOf('if (isPartial)'), SOURCE.indexOf('if (isPartial)') + 1800);
  assert.match(partial, /INSERT INTO payments/, 'the refund is recorded as a payment row');
  assert.match(partial, /-refundedAmount|0 - |negative/i, 'and it is negative');
  assert.match(partial, /pay\.payment_method/, 'out of the box the money was taken into');
  assert.match(partial, /postPaymentJournal/, 'with its own journal entry');
});

test('a partial refund leaves the enrolment and scales the commission', () => {
  const partial = SOURCE.slice(SOURCE.indexOf('if (isPartial)'), SOURCE.indexOf('if (isPartial)') + 2400);
  assert.ok(!partial.includes('revokeCourseEntitlement'),
    'the customer has paid for part of the course and keeps it');
  assert.match(partial, /commission_amount/, 'the commission follows the money that stayed');
  assert.match(partial, /status='refunded'/.test(partial) ? /never/ : /.*/,
    'the original payment is not marked refunded — only part of it came back');
});

test('a full refund still behaves exactly as it did', () => {
  assert.match(SOURCE, /UPDATE payments SET status='refunded'/, 'the full case still marks the payment');
  assert.match(SOURCE, /revokeCourseEntitlement/, 'and still takes the enrolment back');
  assert.match(SOURCE, /crm_commissions SET status='CANCELLED'/, 'and still cancels the commission');
  assert.match(SOURCE, /instructor_fees SET status='rejected'/, 'and the instructor fee with it');
});
