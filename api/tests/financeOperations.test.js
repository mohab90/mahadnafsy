'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { currency, dateOnly, money, sha256, signedMoney, buildCloseChecklist } = require('../lib/financeOperations');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

test('finance operation inputs are bounded and deterministic', () => {
  assert.equal(currency('sar'), 'SAR');
  assert.throws(() => currency('BTC'), /Unsupported currency/);
  assert.equal(dateOnly('2026-07-30'), '2026-07-30');
  assert.equal(dateOnly('30-07-2026'), null);
  assert.equal(money('12.345'), 12.35);
  assert.throws(() => money(-1), /Invalid monetary amount/);
  assert.equal(signedMoney('-250.125'), -250.13);
  assert.equal(sha256({ stable: true }), sha256({ stable: true }));
});

test('close checklist is tenant and period scoped and blocks every non-zero exception', async () => {
  const calls = [];
  const db = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return [[{
        paid_without_journal: 0,
        pending_payments: 0,
        failed_finance_events: 0,
        draft_payables: 1,
        unapproved_bank_reconciliations: 0,
        unbalanced_journals: 0,
      }]];
    },
  };
  const checklist = await buildCloseChecklist(db, 'tenant-a', { period_label: '2026-07' });
  assert.equal(checklist.ready, false);
  assert.equal(checklist.items.find(item => item.key === 'draft_payables').blocking, true);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].params.filter(value => value === 'tenant-a').length >= 6);
});





