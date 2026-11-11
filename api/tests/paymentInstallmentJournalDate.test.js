'use strict';
// An instalment confirmed with a payment date is booked on THAT day in the ledger, not on the day it is recorded; a malformed date is refused.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { install, run, TENANT } = require('./_routeHarness');

process.env.ADMIN_EMAILS = 'owner@unit.test';
const h = install();
const router = require('../routes/installments');
after(() => setTimeout(() => process.exit(), 300).unref());

const PAY_PATH = '/api/admin/installment-plans/:planId/entries/:index/pay';
const plan = {
  id: 'plan-1', tenant_id: TENANT, subscriber_id: 'sub-1', course_id: null, bundle_id: null, title: 'Track', currency: 'EGP',
  total_amount: 3000, installments_count: 3, paid_count: 0, installment_amounts: '[1000,1000,1000]',
  due_dates: '["2026-10-01","2026-11-01","2026-12-01"]', paid_dates: '[null,null,null]', payment_ids: '[null,null,null]', paid_amounts: '[null,null,null]',
  branch: 'ONLINE_EGYPT', branch_id: 'branch-online-egypt', assigned_cs_id: null, assigned_sales_id: null, subscriber_phone: '01012345678',
};
const ACCOUNTS = { id: 'st-acc', role: 'ACCOUNTANT', data_scope: 'all', permissions_json: JSON.stringify(['manage_financial', 'view_financial']) };
const statements = pattern => h.calls.filter(c => pattern.test(c.sql));
test.beforeEach(() => {
  h.calls.length = 0; h.state.transactions.length = 0; h.state.staff = null;
  h.state.answer = sql => {
    if (/FROM installment_plans ip/.test(sql)) return [plan];
    if (/FROM accounting_periods/.test(sql)) return [];
    if (/FROM finance_document_sequences/.test(sql)) return [{ next_number: 2 }];
    if (/FROM tenant_chart_of_accounts/.test(sql)) return ['1100', '4100', '4900'].map(code => ({ code, is_active: 1 }));
    if (/FROM payments p\s+LEFT JOIN subscribers/.test(sql)) return [{ id: 'x', amount: '1000', amount_egp: '1000', currency: 'EGP', date: '2026-10-30', payment_type: 'OTHER' }];
    return undefined;
  };
});

test('a backdated instalment is journalled on its own date, in the same period the lock was checked for', async () => {
  const res = await run(router, 'POST', PAY_PATH, { as: ACCOUNTS, params: { planId: 'plan-1', index: '0' }, body: { amount: 1000, paymentMethod: 'cash', paidDate: '2026-10-30' }, harness: h });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const periods = statements(/FROM accounting_periods/).map(c => c.params[1]);
  assert.ok(periods.length && periods.every(label => label === '2026-10'), `the lock is read for October only: ${periods}`);
  const entry = statements(/INSERT INTO journal_entries/)[0];
  assert.equal(entry.params[6], '2026-10-30', 'entry_date is the payment date');
  assert.ok(statements(/INSERT INTO payments/)[0].params.includes('2026-10-30'));
});

test('a payment date that is not a date is refused before anything is written', async () => {
  for (const paidDate of ['yesterday', '30/10/2026', '2026-10']) {
    h.calls.length = 0;
    const res = await run(router, 'POST', PAY_PATH, { as: ACCOUNTS, params: { planId: 'plan-1', index: '0' }, body: { amount: 1000, paymentMethod: 'cash', paidDate }, harness: h });
    assert.equal(res.status, 400, paidDate);
    assert.equal(res.body.code, 'PAYMENT_DATE_INVALID');
    assert.equal(h.calls.length, 0);
  }
});
