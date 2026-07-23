'use strict';
/**
 * The refund approval logic lives inline in two duplicated Express route
 * handlers (api/routes/admin-utils.js and api/routes/finance.js) rather than
 * in a standalone function — so unlike lib/periodLock.js or
 * lib/courseCompletion.js, there is nothing here that accepts an injectable
 * connection to exercise with a mock. Behavioral testing of the actual
 * refund/reversal logic is planned as part of the Phase 1 roadmap item that
 * unifies both copies behind one applyRefundReversal(paymentId, actor, conn,
 * tenantId) function (see the "خطة التطوير الهندسية" roadmap, Phase 1) — at
 * that point this file should be rewritten the same way
 * lmsCompletionIntegrity.test.js was, with a mock conn and real assertions on
 * thrown errors / issued queries, not regexes against source text.
 *
 * Until then, these remain intentionally-labeled static contract checks —
 * cheap regression locks for wiring facts (which status string is used,
 * which tenant guard exists), NOT behavioral coverage. Do not mistake a pass
 * here for proof the refund logic works.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('[static contract, not behavioral] refund approval and finance reports use the same refunded payment status string', () => {
  const refundRoute = fs.readFileSync(path.join(root, 'routes', 'admin-utils.js'), 'utf8');
  const financialAnalytics = fs.readFileSync(path.join(root, 'routes', 'analytics', 'financial.js'), 'utf8');
  const financePay = fs.readFileSync(path.join(root, 'routes', 'core', 'financepay.js'), 'utf8');

  assert.match(refundRoute, /UPDATE payments SET status=.*refunded/);
  assert.match(refundRoute, /'update', oldPay\.status \|\| null, 'refunded'/);
  assert.match(financialAnalytics, /status='refunded'/);
  assert.match(financePay, /'refunded'/);
});

test('[static contract, not behavioral] refund workflow reads/mutates are all tenant-scoped in the WHERE clause', () => {
  const refundRoute = fs.readFileSync(path.join(root, 'routes', 'admin-utils.js'), 'utf8');

  assert.match(refundRoute, /refund_requests WHERE tenant_id=\? AND subscriber_id=\?/);
  assert.match(refundRoute, /WHERE r\.id=\? AND r\.tenant_id=\? FOR UPDATE/);
  assert.match(refundRoute, /payments WHERE id=\? AND tenant_id=\? AND subscriber_id=\? LIMIT 1 FOR UPDATE/);
  assert.match(refundRoute, /DELETE FROM enrollments WHERE tenant_id=\?/);
  assert.match(refundRoute, /UPDATE crm_commissions SET[\s\S]*tenant_id=\?/);
});

test.todo('refund reversal actually calls periodLock.assertWritable before mutating payments (Phase 1: currently does not — see roadmap PAY-04/finance.js:1083)');
test.todo('refund reversal updates orders.status alongside payments.status in the same transaction (Phase 1 — see roadmap PAY-05)');
test.todo('the two duplicated refund-approval code paths (admin-utils.js vs finance.js) produce identical results given the same input (Phase 1: unify behind applyRefundReversal)');
