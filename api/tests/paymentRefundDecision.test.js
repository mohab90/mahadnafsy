'use strict';
// Approving a refund request through the real route and the real reversal: the books (one balanced reversing entry, the payment marked
// refunded, the order flipped), the partial path (a negative row, never more than was paid), and the case with no payment left to reverse.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { install, run, TENANT } = require('./_routeHarness');

process.env.ADMIN_EMAILS = 'owner@unit.test';
const h = install();
const router = require('../routes/finance/refunds');
after(() => setTimeout(() => process.exit(), 300).unref());

const ACCOUNTS = { id: 'st-acc', role: 'ACCOUNTANT', data_scope: 'all', name: 'Acc', permissions_json: JSON.stringify(['view_financial', 'approve_refunds']) };
const statements = pattern => h.calls.filter(c => pattern.test(c.sql));
const request = (over = {}) => ({ id: 'rf-1', status: 'PENDING', amount: '1000.00', currency: 'EGP', payment_id: 'pay-1', course_item: null, subscriber_id: 'sub-1', branch_id: 'branch-daqqi', assigned_cs_id: null, assigned_sales_id: null, ...over });
const payment = (over = {}) => ({ id: 'pay-1', subscriber_id: 'sub-1', course_id: null, bundle_id: null, amount: '1000.00', amount_egp: '1000.00', currency: 'EGP', payment_type: 'OTHER', payment_method: 'cash', source: 'staff', status: 'paid', transaction_id: null, branch: 'DAQQI', branch_id: 'branch-daqqi', date: '2026-11-01', created_at: '2026-11-01', ...over });
function tables({ pay = payment(), req = request(), refundedBefore = 0 } = {}) {
  h.state.answer = sql => {
    if (/FROM refund_requests rr/.test(sql)) return [req];
    if (/FROM payments WHERE id = \?/.test(sql)) return pay ? [pay] : [];
    if (/FROM refunds WHERE/.test(sql)) return [{ total: refundedBefore }];
    if (/FROM payments WHERE tenant_id=\? AND subscriber_id=\? AND source='refund'/.test(sql)) return [{ total: 0 }];
    if (/FROM accounting_periods/.test(sql)) return [];
    if (/FROM finance_document_sequences/.test(sql)) return [{ next_number: 2 }];
    if (/FROM tenant_chart_of_accounts/.test(sql)) return ['1100', '4100', '4900'].map(code => ({ code, is_active: 1 }));
    return undefined;
  };
}
const approve = body => run(router, 'PUT', '/api/admin/finance/refunds/:id', { as: ACCOUNTS, params: { id: 'rf-1' }, body: { status: 'APPROVED', ...body }, harness: h });
test.beforeEach(() => { h.calls.length = 0; h.state.transactions.length = 0; h.state.staff = null; });

test('a full refund marks the payment refunded and posts ONE balanced reversal (revenue debited, cash credited), then commits once', async () => {
  tables();
  const res = await approve({});
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(statements(/UPDATE payments SET status='refunded'/)[0].params.slice(1), ['pay-1', TENANT]);
  assert.equal(statements(/INSERT INTO journal_entries/).length, 1);
  const lines = statements(/INSERT INTO journal_entry_lines/);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map(l => [l.params[2], l.params[4], l.params[5]]).sort(), [['1100', 0, 1000], ['4900', 1000, 0]]);
  assert.equal(statements(/INSERT INTO payments/).length, 0, 'a full refund rewrites the payment, it adds no negative row');
  assert.equal(h.state.transactions.filter(t => t === 'commit').length, 1);
});

test('a partial refund writes one negative row and its reversing entry; one that exceeds what is left of the payment is refused and books nothing', async () => {
  tables({ req: request({ amount: '400.00' }) });
  const ok = await approve({ refunded_amount: 400 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const row = statements(/INSERT INTO payments/)[0];
  assert.ok(row.params.includes(-400), 'a negative amount');
  assert.equal(statements(/UPDATE payments SET status='refunded'/).length, 0, 'the payment itself is not rewritten');
  const lines = statements(/INSERT INTO journal_entry_lines/);
  assert.deepEqual(lines.map(l => l.params[4] - l.params[5]).sort((a, b) => a - b), [-400, 400]);

  h.calls.length = 0; h.state.transactions.length = 0;
  tables({ req: request({ amount: '700.00' }), refundedBefore: 700 });
  const over = await approve({ refunded_amount: 700 });
  assert.equal(over.status, 409, '700 + 700 is 1400 of a payment of 1000');
  assert.equal(statements(/INSERT INTO (payments|journal_entries)/).length, 0);
  assert.ok(h.state.transactions.includes('rollback') && !h.state.transactions.includes('commit'));
});

test('approving when the payment behind the request is gone is refused and rolled back, instead of approving a refund nothing accounts for', async () => {
  tables({ pay: null });
  const res = await approve({});
  assert.equal(res.status, 409);
  assert.ok(h.state.transactions.includes('rollback'));
  assert.ok(!h.state.transactions.includes('commit'), 'the request is not left approved');
  assert.equal(statements(/INSERT INTO (payments|journal_entries)/).length, 0);
});

test('a refund into a closed accounting period is refused and books nothing', async () => {
  tables();
  const base = h.state.answer;
  h.state.answer = sql => (/FROM accounting_periods/.test(sql) ? [{ id: 'ap', period_label: '2026-11', status: 'closed' }] : base(sql));
  const res = await approve({});
  assert.equal(res.status, 409);
  assert.equal(statements(/INSERT INTO (payments|journal_entries)|UPDATE payments/).length, 0);
});
