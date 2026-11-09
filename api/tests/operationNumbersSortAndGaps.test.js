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



test('the numbers a branch is missing are found, deleted ones apart from those that never existed', () => {
  const problems = sequenceProblems([
    { receiptNo: 1, deleted: false }, { receiptNo: 2, deleted: false }, { receiptNo: 5, deleted: false }, { receiptNo: 6, deleted: true }, { receiptNo: 9, deleted: false },
  ]);
  assert.deepEqual(problems.missing, [3, 4, 7, 8]);
  assert.deepEqual(problems.removed.map(row => row.receiptNo), [6]);
  assert.equal(problems.highest, 9);
  assert.deepEqual(sequenceProblems([{ receiptNo: 1, deleted: false }, { receiptNo: 2, deleted: false }]).missing, []);
});


