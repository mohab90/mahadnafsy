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

test('accounts payable posts accrual and payment journals with three-way SOD', () => {
  const route = read('routes/finance-operations.js');
  assert.match(route, /AP_APPROVAL_SOD/);
  assert.match(route, /AP_PAYMENT_SOD/);
  assert.match(route, /accounts_payable_accrual/);
  assert.match(route, /accounts_payable_payment/);
  assert.match(route, /Only a draft payable can be voided/);
  assert.match(route, /paymentAmount > remaining/);
  assert.match(route, /tenant_id=\?/);
});

test('bank reconciliation and period close require zero difference and independent approval', () => {
  const route = read('routes/finance-operations.js');
  const accounting = read('routes/accounting.js');
  assert.match(route, /BANK_RECONCILIATION_SOD/);
  assert.match(route, /Math\.abs\(Number\(row\.difference_amount\)\) >= 0\.01/);
  assert.match(route, /PERIOD_CLOSE_SOD/);
  assert.match(accounting, /PERIOD_CLOSE_APPROVAL_REQUIRED/);
  assert.match(accounting, /closeRequest\.reviewed_by/);
  assert.match(accounting, /status='consumed',consumed_at=NOW\(\)/);
});

test('finance operations migrations establish AP, bank reconciliation and close approval contracts', () => {
  const ap = read('migrations/167_v25_accounts_payable.sql');
  const bank = read('migrations/168_v25_bank_reconciliation.sql');
  const close = read('migrations/169_v25_accounting_close_approval.sql');
  const closeGuard = read('migrations/170_v25_accounting_close_request_guard.sql');
  const bankGuard = read('migrations/171_v25_bank_reconciliation_scope_guard.sql');
  assert.match(ap, /UNIQUE KEY uq_ap_vendor_invoice/);
  assert.match(ap, /UNIQUE KEY uq_ap_payment_reference/);
  assert.match(bank, /UNIQUE KEY uq_bank_reconciliation_period/);
  assert.match(close, /checklist_sha256 CHAR\(64\)/);
  assert.match(closeGuard, /uq_accounting_close_request_active/);
  assert.match(bankGuard, /COALESCE\(branch_id,'__CENTRAL__'\)/);
});
