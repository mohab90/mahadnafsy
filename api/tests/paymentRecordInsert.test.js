'use strict';
// The desk's recording route end to end on a recording database: what one paid payment writes (the payment, its balanced journal entry,
// the audit row, one commit), that the amount is judged at the piastre it is stored in, and that a closed period stops it.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { install, run, TENANT } = require('./_routeHarness');

process.env.ADMIN_EMAILS = 'owner@unit.test';
const h = install();
const router = require('../routes/subscriber-payments');
after(() => setTimeout(() => process.exit(), 300).unref());

const PATH = '/api/admin/subscriber-payments';
const SUBSCRIBER = { id: 'sub-1', name: 'Hind', email: null, phone: '01012345678', lead_id: null, assigned_sales_id: null, assigned_cs_id: null, tenant_id: TENANT, branch: 'ONLINE_EGYPT', branch_id: 'branch-online-egypt', client_code: 'C1' };
const statements = pattern => h.calls.filter(c => pattern.test(c.sql));
function tables({ closed = false } = {}) {
  h.state.answer = sql => {
    if (/FROM subscribers\s+WHERE id=\?/.test(sql)) return [SUBSCRIBER];
    if (/SELECT GET_LOCK/.test(sql)) return [{ acquired: 1 }];
    if (/FROM accounting_periods/.test(sql)) return closed ? [{ id: 'ap', period_label: '2026-11', status: 'closed' }] : [];
    if (/FROM finance_document_sequences/.test(sql)) return [{ next_number: 2 }];
    if (/FROM tenant_chart_of_accounts/.test(sql)) return ['1100', '4900'].map(code => ({ code, is_active: 1 }));
    if (/FROM payments p\s+LEFT JOIN subscribers/.test(sql)) return [{ id: 'x', amount: '100', amount_egp: '100', currency: 'EGP', date: '2026-11-11', payment_type: 'OTHER' }];
    return undefined;
  };
}
const record = payment => run(router, 'POST', PATH, { as: 'owner', body: { subscriber_id: 'sub-1', payment: { currency: 'EGP', paymentMethod: 'cash', paymentType: 'OTHER', ...payment } }, harness: h });
test.beforeEach(() => { h.calls.length = 0; h.state.transactions.length = 0; h.state.staff = null; tables(); });

test('one paid payment writes one payment row, one balanced two-line entry on the same day, one audit row, and commits once', async () => {
  const res = await record({ amount: 1200.5, date: '2026-11-05' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const inserts = statements(/INSERT INTO payments/);
  assert.equal(inserts.length, 1);
  assert.ok(inserts[0].params.includes(1200.5) && inserts[0].params.includes(TENANT) && inserts[0].params.includes('2026-11-05'));
  const entries = statements(/INSERT INTO journal_entries/);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].params[6], '2026-11-05', 'the entry is on the payment date');
  const lines = statements(/INSERT INTO journal_entry_lines/);
  assert.deepEqual(lines.map(l => [l.params[2], l.params[4], l.params[5]]).sort(), [['1100', 1200.5, 0], ['4900', 0, 1200.5]]);
  assert.equal(statements(/INSERT INTO payment_audit_log/).length, 1);
  assert.equal(h.state.transactions.filter(t => t === 'commit').length, 1);
  assert.ok(!h.state.transactions.includes('rollback'));
});

test('an amount is stored and journalled at the same piastre: 100.005 is 100.01 in both, and one that rounds to nothing is refused', async () => {
  const res = await record({ amount: 100.005 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(statements(/INSERT INTO payments/)[0].params.includes(100.01), 'the row carries the rounded amount, not 100.005');
  const lines = statements(/INSERT INTO journal_entry_lines/);
  assert.deepEqual(lines.map(l => l.params[4] + l.params[5]).sort(), [100.01, 100.01]);

  h.calls.length = 0;
  const none = await record({ amount: 0.004 });
  assert.equal(none.status, 400);
  assert.equal(none.body.code, 'AMOUNT_INVALID');
  assert.equal(h.calls.length, 0);
});

test('recording into a closed accounting period is refused with nothing written', async () => {
  tables({ closed: true });
  const res = await record({ amount: 500 });
  assert.equal(res.status, 409, 'said as a refusal, not as «Internal server error»');
  assert.equal(res.body.code, 'ACCOUNTING_PERIOD_CLOSED');
  assert.match(res.body.error, /مقفولة/);
  assert.equal(statements(/INSERT INTO (payments|journal_entries)/).length, 0);
  assert.ok(h.state.transactions.includes('rollback') && !h.state.transactions.includes('commit'));
});
