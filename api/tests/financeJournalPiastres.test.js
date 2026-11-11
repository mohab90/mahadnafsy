'use strict';
// A journal entry is judged at the precision it is stored in. The column holds two decimals; the old checks compared raw floats with a
// 0.01 tolerance, so an entry could pass and then land one piastre out of balance (100.006 against 100 stored as 100.01 against 100.00).
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { install, run } = require('./_routeHarness');

process.env.ADMIN_EMAILS = 'owner@unit.test';
const h = install();
const { postJournalEntry } = require('../lib/finance');
const router = require('../routes/accounting-erp');
after(() => setTimeout(() => process.exit(), 300).unref());

function recordingDb() {
  const inserts = [];
  return {
    inserts,
    async query(sql, params) {
      if (sql.includes('FROM accounting_periods')) return [[]];
      if (sql.includes('SELECT code,is_active FROM tenant_chart_of_accounts')) return [params.slice(1).map(code => ({ code, is_active: 1 }))];
      inserts.push({ sql, params });
      return [{}];
    },
  };
}
const post = (db, lines) => postJournalEntry('manual', 'r-1', '2026-11-01', 'test', lines, 'tester', db, 'tenant-a');
const cash = (debit, credit) => ({ account_code: '1100', account_name: 'cash', debit, credit });
const revenue = (debit, credit) => ({ account_code: '4100', account_name: 'rev', debit, credit });

test('postJournalEntry refuses an entry that is a piastre out of balance once rounded, and posts one that only floats disagree on', async () => {
  const db = recordingDb();
  assert.equal(await post(db, [cash(100.006, 0), revenue(0, 100)]), null, '100.01 against 100.00 is not balanced');
  assert.equal(db.inserts.length, 0, 'nothing reaches the ledger');

  const ok = await post(db, [cash(0.1 + 0.2, 0), revenue(0, 0.3)]);
  assert.ok(ok, '0.1+0.2 against 0.3 balances to the piastre');
  const lines = db.inserts.filter(i => i.sql.includes('INSERT INTO journal_entry_lines'));
  assert.deepEqual(lines.map(l => [l.params[4], l.params[5]]), [[0.3, 0], [0, 0.3]], 'stored with two decimals, not 0.30000000000000004');
  const header = db.inserts.find(i => i.sql.includes('INSERT INTO journal_entries'));
  assert.equal(header.params[8], 0.3);
  assert.equal(header.params[9], 0.3);
});

test('postJournalEntry rounds each line the way the column will, so the totals are the sum of what is stored', async () => {
  const db = recordingDb();
  // 50.004 + 50.004 stores as 50.00 + 50.00; the other side is 100.00.
  assert.ok(await post(db, [cash(50.004, 0), cash(50.004, 0), revenue(0, 100)]));
  const lines = db.inserts.filter(i => i.sql.includes('INSERT INTO journal_entry_lines'));
  assert.deepEqual(lines.map(l => l.params[4]), [50, 50, 0]);
  // And the mirror image that used to pass and unbalance: 33.335 ×3 stores as 33.34 each (100.02) against 100.
  const db2 = recordingDb();
  assert.equal(await post(db2, [cash(33.335, 0), cash(33.335, 0), cash(33.335, 0), revenue(0, 100)]), null);
  assert.equal(db2.inserts.length, 0);
});

test('a manual journal entry through its route is judged the same way: a piastre out is refused, an exact one is booked with two-decimal lines', async () => {
  const OWNER = 'owner';
  h.state.answer = sql => {
    if (/FROM accounting_periods/.test(sql)) return [];
    if (/FROM tenant_chart_of_accounts/.test(sql)) return [{ code: '1100', name: 'cash', is_active: 1 }, { code: '4100', name: 'rev', is_active: 1 }];
    return undefined;
  };
  const submit = lines => run(router, 'POST', '/api/admin/accounting/journal-entries', { as: OWNER, body: { date: '2026-11-01', description: 'adjust', lines }, harness: h });

  h.calls.length = 0;
  const out = await submit([{ account_code: '1100', debit: 100.006 }, { account_code: '4100', credit: 100 }]);
  assert.equal(out.status, 400);
  assert.equal(h.calls.filter(c => /INSERT INTO journal/.test(c.sql)).length, 0);

  const onePiastre = await submit([{ account_code: '1100', debit: 100 }, { account_code: '4100', credit: 99.99 }]);
  assert.equal(onePiastre.status, 400, 'a piastre out of balance is refused every time, not only when the floats happen to differ enough');

  h.calls.length = 0;
  const ok = await submit([{ account_code: '1100', debit: 0.1 + 0.2 }, { account_code: '4100', credit: 0.3 }]);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const lines = h.calls.filter(c => /INSERT INTO journal_entry_lines/.test(c.sql));
  assert.deepEqual(lines.map(l => [l.params[4], l.params[5]]), [[0.3, 0], [0, 0.3]]);
  assert.equal(h.calls.find(c => /INSERT INTO journal_entries/.test(c.sql)).params[4], 0.3);
});
