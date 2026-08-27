'use strict';
/**
 * Unit tests for the financial core (GL account mapping + currency conversion).
 * Pure-function tests — no DB connection needed (db pool is lazy). Run: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _paymentAccountCode, _expenseAccountCode, toEgp } = require('../lib/finance');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const financeSrc = fs.readFileSync(path.join(root, 'lib/finance.js'), 'utf8');
const erpRoute = fs.readFileSync(path.join(root, 'routes/accounting-erp.js'), 'utf8');

test('payment GL account: revenue codes per payment type', () => {
  assert.deepEqual(_paymentAccountCode('COURSE'),       ['4100', 'إيرادات كورسات']);
  assert.deepEqual(_paymentAccountCode('CONSULTATION'), ['4200', 'إيرادات استشارات']);
  assert.deepEqual(_paymentAccountCode('CERTIFICATE'),  ['4300', 'إيرادات شهادات']);
});

test('payment GL account: unknown type falls back to 4900 (other revenue)', () => {
  assert.deepEqual(_paymentAccountCode('BOOK'),    ['4900', 'إيرادات أخرى']);
  assert.deepEqual(_paymentAccountCode(undefined), ['4900', 'إيرادات أخرى']);
  assert.deepEqual(_paymentAccountCode(''),        ['4900', 'إيرادات أخرى']);
});

test('expense GL account: known categories + case-insensitive + fallback', () => {
  assert.deepEqual(_expenseAccountCode('SALARIES'),  ['5100', 'رواتب موظفين']);
  assert.deepEqual(_expenseAccountCode('marketing'), ['5500', 'تسويق وإعلانات']); // case-insensitive
  assert.deepEqual(_expenseAccountCode('UNKNOWN'),   ['5900', 'مصروفات أخرى']);
  assert.deepEqual(_expenseAccountCode(null),        ['5900', 'مصروفات أخرى']);
});

test('toEgp: EGP passes through unchanged (no FX lookup)', async () => {
  assert.equal(await toEgp(1500, 'EGP'), 1500);
  assert.equal(await toEgp(1500, 'egp'), 1500); // case-insensitive
  assert.equal(await toEgp('250', 'EGP'), 250); // numeric string coercion
});

test('toEgp: invalid/empty amount coerces to 0 (never NaN)', async () => {
  assert.equal(await toEgp(undefined, 'EGP'), 0);
  assert.equal(await toEgp('abc', 'EGP'), 0);
  assert.equal(await toEgp(null, 'EGP'), 0);
});


test('a journal entry cannot be posted with a date that is not a date', () => {
  // The shape check accepted '0000-00-00' — four digits, two, two — so the
  // entry went into the ledger and then fell outside every dated report: in
  // the books, in no period. Two entries on production carry one.
  assert.ok(financeSrc.includes('const isRealDate ='),
    'the ledger needs a real-date check, not a shape check');
  assert.ok(financeSrc.includes("!String(v).startsWith('0000-00-00')"),
    'a zero date must be refused');
  assert.ok(financeSrc.includes('!isRealDate(date)'),
    'the entry date must go through it');
  // The manual-entry route wrote whatever string it was given.
  assert.ok(erpRoute.includes("error: 'تاريخ القيد غير صحيح'"),
    'a manual entry with an unreadable date must be refused');
});
