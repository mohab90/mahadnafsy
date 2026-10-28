'use strict';

// «محتاجين في الحسابات زر يرتب أرقام العمليات بالترتيب ويطلع الأرقام الناقصة» (28 Oct 2026): the payments register sorted by its operation numbers
// (each branch's receipts in their own run, then the rest by their running number), and every missing or removed number listed.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-operation-numbers-0123456789abcdef';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf8');
const { sequenceProblems } = require('../lib/receiptNumbers');

test('the register can be asked for its rows by number, and says each row\'s branch', () => {
  const route = read('api/routes/finance-payments-register.js');
  assert.match(route, /const byNumber = req\.query\.sort === 'number';/);
  assert.match(route, /ORDER BY \$\{byNumber \? 'CASE WHEN p\.receipt_no IS NULL THEN 1 ELSE 0 END, p\.branch ASC, COALESCE\(p\.receipt_no, p\.payment_no\) ASC' : 'p\.date DESC, p\.payment_no DESC'\}/);
  assert.match(route, /branch: r\.branch \|\| null,/);
});

test('the numbers a branch is missing are found, deleted ones apart from those that never existed', () => {
  const problems = sequenceProblems([
    { receiptNo: 1, deleted: false }, { receiptNo: 2, deleted: false }, { receiptNo: 5, deleted: false }, { receiptNo: 6, deleted: true }, { receiptNo: 9, deleted: false },
  ]);
  assert.deepEqual(problems.missing, [3, 4, 7, 8]);
  assert.deepEqual(problems.removed.map(row => row.receiptNo), [6]);
  assert.equal(problems.highest, 9);
  assert.deepEqual(sequenceProblems([{ receiptNo: 1, deleted: false }, { receiptNo: 2, deleted: false }]).missing, []);
});

test('the screen has the button, sorts by the number, and lists every missing number, not the first twenty', () => {
  const register = read('admin/pages/dashboard/tabs/financial/PaymentsRegister.tsx');
  assert.match(register, /if \(byNumber\) params\.set\('sort', 'number'\);/);
  assert.match(register, /\{byNumber && <ReceiptGapsReport branch=\{branch \? branch\.toUpperCase\(\) : undefined\} \/>\}/);
  assert.match(register, /ترتيب أرقام العمليات \+ الناقص/);
  const report = read('admin/pages/dashboard/tabs/daqqi/ReceiptGapsAlert.tsx');
  assert.match(report, /export function ReceiptGapsReport\(/);
  assert.match(report, /<RunProblems whole limit=\{Infinity\}/);
  assert.match(report, /التسلسل كامل ✓/);
  // the alert above the screen still shows only twenty and nothing when whole
  assert.match(report, /limit = 20, whole = false/);
});
