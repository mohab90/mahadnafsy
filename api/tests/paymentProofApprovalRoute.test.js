'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { install, run, TENANT } = require('./_routeHarness');

process.env.ADMIN_EMAILS = 'owner@unit.test';
const h = install();
const router = require('../routes/payment-proofs');
after(() => setTimeout(() => process.exit(), 300).unref());
const ACCOUNTANT = { id: 'st-acc', role: 'ACCOUNTANT', data_scope: 'all', name: 'Acc', permissions_json: JSON.stringify(['manage_financial', 'view_financial', 'confirm_transfers']) };
const proofRow = (over = {}) => ({
  id: 'pp-1', order_id: 'o-1', subscriber_id: 'sub-1', course_id: 'c-1', bundle_id: null, item_type: 'course', amount: '2500.00', currency: 'EGP',
  payment_method: 'instapay', proof_image: null, proof_url: null, note: null, status: 'PENDING', branch_id: 'branch-daqqi', payment_intent_id: null,
  payment_attempt_id: null, second_review_required: 0, first_reviewer_id: null, review_due_at: null, order_amount: '2500.00', order_currency: 'EGP',
  order_status: 'pending', order_notes: null, item_id: 'c-1', item_title: 'Course', customer_name: 'A', customer_email: null, customer_phone: null,
  lead_id: null, branch: 'DAQQI', assigned_sales_id: null, ...over,
});
const statements = pattern => h.calls.filter(c => pattern.test(c.sql));
// What the tables answer while the money is booked: the receipt, an open period list, a chart of accounts, and the payment row the
// compensation step reads back once the journal has stamped its EGP amount.
function books(proof, { closed = false } = {}) {
  h.state.answer = sql => {
    if (/FROM payment_proofs pp/.test(sql)) return [proof];
    if (/FROM accounting_periods/.test(sql)) return closed ? [{ id: 'ap-1', period_label: 'x', status: 'closed' }] : [];
    if (/FROM subscribers s JOIN courses c/.test(sql)) return [{ subscriber_id: 'sub-1', branch_id: 'branch-daqqi', course_id: 'c-1' }];
    if (/FROM finance_document_sequences/.test(sql)) return [{ next_number: 2 }];
    if (/FROM tenant_chart_of_accounts/.test(sql)) return ['1100', '4100', '4200', '4300', '4900'].map(code => ({ code, is_active: 1 }));
    if (/FROM payments p\s+LEFT JOIN subscribers/.test(sql)) return [{ id: 'proof-pp-1', amount: proof.amount, amount_egp: proof.amount, currency: 'EGP', date: '2026-11-11', payment_type: 'COURSE' }];
    return undefined;
  };
}
test.beforeEach(() => { h.calls.length = 0; h.state.transactions.length = 0; h.state.staff = null; });

test('approving a receipt books ONE payment (id from the receipt), ONE balanced journal entry, marks the order paid and commits once', async () => {
  books(proofRow());
  const res = await run(router, 'PATCH', '/api/admin/payment-proofs/:id', { as: ACCOUNTANT, params: { id: 'pp-1' }, body: { action: 'approve', reviewer_note: 'matches the bank' }, harness: h });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { ok: true, status: 'APPROVED' });
  const inserts = statements(/INSERT INTO payments/);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].params[0], 'proof-pp-1', 'a fixed id: approving the same receipt twice cannot create a second payment');
  assert.equal(inserts[0].params[4], '2500.00');
  assert.ok(inserts[0].params.includes(TENANT));
  const entries = statements(/INSERT INTO journal_entries/);
  assert.equal(entries.length, 1);
  const lines = statements(/INSERT INTO journal_entry_lines/);
  assert.equal(lines.length, 2);
  const debit = lines.reduce((s, c) => s + Number(c.params[4]), 0);
  const credit = lines.reduce((s, c) => s + Number(c.params[5]), 0);
  assert.equal(debit, 2500);
  assert.equal(credit, 2500, 'the entry balances');
  assert.deepEqual(statements(/UPDATE orders SET status='paid'/)[0].params, ['pp-1', 'o-1', TENANT]);
  assert.equal(h.state.transactions.filter(t => t === 'commit').length, 1);
  assert.ok(!h.state.transactions.includes('rollback'));
});

test('approving into a closed accounting period is refused and books nothing', async () => {
  books(proofRow(), { closed: true });
  const res = await run(router, 'PATCH', '/api/admin/payment-proofs/:id', { as: ACCOUNTANT, params: { id: 'pp-1' }, body: { action: 'approve' }, harness: h });
  assert.equal(res.status, 409);
  assert.equal(statements(/INSERT INTO payments|INSERT INTO journal_entries/).length, 0);
  assert.ok(h.state.transactions.includes('rollback'));
  assert.ok(!h.state.transactions.includes('commit'));
});
