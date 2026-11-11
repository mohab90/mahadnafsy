'use strict';
// Confirming an order into a closed accounting period is a refusal the desk can read, not «Internal server error», and books nothing.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { install, run } = require('./_routeHarness');

process.env.ADMIN_EMAILS = 'owner@unit.test';
const h = install();
const router = require('../routes/orders');
after(() => setTimeout(() => process.exit(), 300).unref());

test('confirm-payment into a closed period answers 409 with the period message and writes nothing', async () => {
  h.calls.length = 0; h.state.transactions.length = 0;
  h.state.answer = sql => {
    if (/FROM orders WHERE id=\?/.test(sql)) return [{ id: 'o-1', status: 'PENDING', subscriber_id: 'sub-1', staff_id: null, payment_method: 'cash', amount: '500.00', currency: 'EGP', branch_id: 'branch-daqqi' }];
    if (/FROM subscribers WHERE tenant_id=\?/.test(sql)) return [{ id: 'sub-1', branch_id: 'branch-daqqi', assigned_sales_id: null, assigned_cs_id: null }];
    if (/FROM accounting_periods/.test(sql)) return [{ id: 'ap', period_label: '2026-11', status: 'closed' }];
    return undefined;
  };
  const res = await run(router, 'POST', '/api/admin/orders/:id/confirm-payment', { as: 'owner', params: { id: 'o-1' }, body: {}, harness: h });
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.match(res.body.error, /مقفولة/);
  assert.equal(h.calls.filter(c => /^(INSERT|UPDATE)/.test(c.sql)).length, 0);
  assert.ok(h.state.transactions.includes('rollback') && !h.state.transactions.includes('commit'));
});
