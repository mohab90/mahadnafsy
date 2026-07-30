'use strict';
/**
 * Status update (Phase 1.d of the roadmap): the refund reversal logic that
 * used to live duplicated inline in two Express handlers (api/routes/
 * admin-utils.js and api/routes/finance.js) is now unified behind
 * lib/refunds.js#applyRefundReversal(), called from finance.js's PUT
 * /api/admin/finance/refunds/:id (the endpoint CustomerInboxTab.tsx actually
 * calls). The dead admin-utils.js copy (confirmed zero frontend callers) was
 * removed rather than kept in sync with a second copy of the same logic.
 *
 * Real behavioral coverage — with a mock connection, asserting on thrown
 * errors and the exact queries issued, not regexes against source text —
 * now lives in api/tests/refunds.test.js. That file covers all three gaps
 * this file used to track as test.todo(): the period-lock check
 * (PAY-04), the orders.status update (PAY-05), and there being one
 * reversal path instead of two (PAY-14).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('[static contract, not behavioral] the live refund route calls the shared applyRefundReversal, not an inline copy', () => {
  const financeRoute = fs.readFileSync(path.join(root, 'routes', 'finance.js'), 'utf8');
  assert.match(financeRoute, /require\(['"]\.\.\/lib\/refunds['"]\)/);
  assert.match(financeRoute, /applyRefundReversal\(\{[\s\S]*paymentId:\s*rr\.payment_id/);
});

test('[static contract, not behavioral] the dead duplicate refund-approval route was actually removed, not just unused', () => {
  const adminUtils = fs.readFileSync(path.join(root, 'routes', 'admin-utils.js'), 'utf8');
  assert.doesNotMatch(adminUtils, /router\.patch\('\/api\/admin\/refund-requests\/:id'/);
});

test('[static contract, not behavioral] refunds reverse the ledger and use the canonical refunded payment status', () => {
  const refunds = fs.readFileSync(path.join(root, 'lib', 'refunds.js'), 'utf8');
  const financePay = fs.readFileSync(path.join(root, 'routes', 'core', 'financepay.js'), 'utf8');
  assert.match(refunds, /postJournalEntry\(\s*'refund'/);
  assert.match(refunds, /status='refunded'/);
  assert.match(financePay, /'refunded'/);
});
