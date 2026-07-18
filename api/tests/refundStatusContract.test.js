'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('refund approval and finance reports use the same refunded payment status', () => {
  const refundRoute = fs.readFileSync(path.join(root, 'routes', 'admin-utils.js'), 'utf8');
  const financialAnalytics = fs.readFileSync(path.join(root, 'routes', 'analytics', 'financial.js'), 'utf8');
  const financePay = fs.readFileSync(path.join(root, 'routes', 'core', 'financepay.js'), 'utf8');

  assert.match(refundRoute, /UPDATE payments SET status=.*refunded/);
  assert.match(refundRoute, /'update', oldPay\.status \|\| null, 'refunded'/);
  assert.match(financialAnalytics, /status='refunded'/);
  assert.match(financePay, /'refunded'/);
});

test('refund workflow cannot read or mutate records outside the resolved tenant', () => {
  const refundRoute = fs.readFileSync(path.join(root, 'routes', 'admin-utils.js'), 'utf8');

  assert.match(refundRoute, /refund_requests WHERE tenant_id=\? AND subscriber_id=\?/);
  assert.match(refundRoute, /WHERE r\.id=\? AND r\.tenant_id=\? FOR UPDATE/);
  assert.match(refundRoute, /payments WHERE id=\? AND tenant_id=\? AND subscriber_id=\? LIMIT 1 FOR UPDATE/);
  assert.match(refundRoute, /DELETE FROM enrollments WHERE tenant_id=\?/);
  assert.match(refundRoute, /UPDATE crm_commissions SET[\s\S]*tenant_id=\?/);
});
