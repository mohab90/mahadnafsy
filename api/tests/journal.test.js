'use strict';
/**
 * Unit tests for the double-entry journal core (lib/finance.postPaymentJournal /
 * postJournalEntry) — the heart of the ledger. Uses the injectable-db param with a
 * mock that captures inserts; EGP amounts avoid the FX/DB path. Run: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { postPaymentJournal, postExpenseJournal, postJournalEntry } = require('../lib/finance');

// Mock pool that records every INSERT (sql + params).
function recordingDb() {
  const inserts = [];
  return { inserts, async query(sql, params) { inserts.push({ sql, params }); return [{}]; } };
}

test('postPaymentJournal posts a tenant-scoped balanced double entry (cash debit = revenue credit)', async () => {
  const db = recordingDb();
  const journalId = await postPaymentJournal({ paymentId: 'PAY1', amount: 1500, currency: 'EGP', payType: 'COURSE', date: '2026-06-01', actor: 'tester', tenantId: 'tenant-a' }, db);
  assert.ok(journalId, 'returns the posted journal id so callers can make commit/rollback decisions');

  const header = db.inserts.find(i => i.sql.includes('INSERT INTO journal_entries'));
  const lines = db.inserts.filter(i => i.sql.includes('INSERT INTO journal_entry_lines'));
  assert.ok(header, 'posts a journal_entries header');
  assert.equal(lines.length, 2, 'posts exactly two lines');

  // header params: [id, tenant_id, ref_type, ref_id, date, desc, total_debit, total_credit, posted_by]
  const totalDebit = header.params[6];
  const totalCredit = header.params[7];
  assert.equal(totalDebit, 1500);
  assert.equal(totalCredit, 1500);
  assert.equal(totalDebit, totalCredit, 'debits must equal credits');
  assert.equal(header.params[1], 'tenant-a');
  assert.equal(header.params[2], 'payment');
  assert.equal(header.params[3], 'PAY1');

  // line params: [id, entry_id, account_code, account_name, debit, credit]
  const cash = lines.find(l => l.params[2] === '1100');
  const revenue = lines.find(l => l.params[2] === '4100'); // COURSE → 4100
  assert.ok(cash && revenue, 'has cash (1100) + course-revenue (4100) lines');
  assert.equal(cash.params[4], 1500, 'cash debited');
  assert.equal(cash.params[5], 0);
  assert.equal(revenue.params[4], 0);
  assert.equal(revenue.params[5], 1500, 'revenue credited');
});

test('postPaymentJournal skips zero/negative amounts (no posting)', async () => {
  const db = recordingDb();
  const journalId = await postPaymentJournal({ paymentId: 'P0', amount: 0, currency: 'EGP', payType: 'COURSE' }, db);
  assert.equal(journalId, null);
  assert.equal(db.inserts.length, 0);
});

test('postPaymentJournal returns null when a caller-owned transaction cannot post the journal', async () => {
  let calls = 0;
  const conn = {
    async query() { calls++; if (calls === 2) throw new Error('line insert failed'); return [{}]; },
    commit() { throw new Error('must NOT commit an injected connection'); },
    rollback() { throw new Error('must NOT rollback an injected connection'); },
    release() { throw new Error('must NOT release an injected connection'); },
  };
  const journalId = await postPaymentJournal({ paymentId: 'PFAIL', amount: 100, currency: 'EGP', payType: 'COURSE' }, conn);
  assert.equal(journalId, null);
});

test('unknown payment type routes to other-revenue (4900)', async () => {
  const db = recordingDb();
  await postPaymentJournal({ paymentId: 'P2', amount: 200, currency: 'EGP', payType: 'BOOK' }, db);
  const revenue = db.inserts.filter(i => i.sql.includes('journal_entry_lines')).find(l => l.params[5] === 200);
  assert.equal(revenue.params[2], '4900');
});

test('postJournalEntry never manages an INJECTED connection (caller owns the transaction)', async () => {
  // Mock connection that throws on the 2nd insert (a journal_entry_lines row).
  let calls = 0;
  const conn = {
    async query() { calls++; if (calls === 2) throw new Error('line insert failed'); return [{}]; },
    commit()   { throw new Error('must NOT commit an injected connection'); },
    rollback() { throw new Error('must NOT rollback an injected connection'); },
    release()  { throw new Error('must NOT release an injected connection'); },
  };
  const result = await postJournalEntry('payment', 'PX', '2026-06-01', 'd', [
    { account_code: '1100', account_name: 'نقدية', debit: 100, credit: 0 },
    { account_code: '4100', account_name: 'إيراد', debit: 0, credit: 100 },
  ], 'tester', conn);
  // Returns null on failure; reaching here proves commit/rollback/release were never
  // called (they would have thrown) — the caller's transaction is left intact.
  assert.equal(result, null);
});

test('postJournalEntry sums arbitrary lines into the header totals', async () => {
  const db = recordingDb();
  await postJournalEntry('expense', 'E1', '2026-06-01', 'test', [
    { account_code: '5100', account_name: 'رواتب', debit: 0, credit: 300 },
    { account_code: '1100', account_name: 'نقدية', debit: 300, credit: 0 },
  ], 'tester', db);
  const header = db.inserts.find(i => i.sql.includes('INSERT INTO journal_entries'));
  assert.equal(header.params[6], 300); // total debit
  assert.equal(header.params[7], 300); // total credit
});

test('expense reversal uses the original EGP snapshot instead of revaluing history', async () => {
  const db = recordingDb();
  const journalId = await postExpenseJournal({
    id: 'EXP-FX-1', tenant_id: 'tenant-a', amount: 10, currency: 'EGP',
    amount_egp: 650, category: 'OTHER', date: '2026-06-01',
  }, -1, 'tester', db, 'tenant-a');
  assert.ok(journalId);
  const header = db.inserts.find(i => i.sql.includes('INSERT INTO journal_entries'));
  assert.equal(header.params[6], 650);
  assert.equal(header.params[7], 650);
  assert.equal(db.inserts.some(i => i.sql.includes('UPDATE expenses SET fx_rate_to_egp')), false);
});
