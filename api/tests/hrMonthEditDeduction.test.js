'use strict';

// The month edit modal's deduction box (11 Nov 2026): a day that cannot carry a deduction sends none, a status change does not leave a figure the new status
// refuses, the help text says what a blank, a zero and a half day cost, and the server ignores a stale figure on a free day instead of answering 400.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bundle } = require('./support/repo');
const { manualDayDeduction } = require('../lib/attendancePolicy');

const box = bundle('admin/pages/dashboard/tabs/hr-sections/monthEditDeduction.ts');
const skip = !box && 'admin dependencies are not installed';

test('a free day, a leave-balance day, a holiday and overtime send no deduction, whatever the box holds', { skip }, () => {
  for (const status of ['HOLIDAY', 'FREE_DAY', 'LEAVE_BALANCE', 'OVERTIME']) assert.equal(box.deductionToSend(status, '2'), undefined, status);
  assert.equal(box.deductionToSend('ABSENT', '2'), 2);
  assert.equal(box.deductionToSend('ABSENT', ''), undefined, 'blank: the rule decides');
  assert.equal(box.deductionToSend('HALF_DAY', '0.5'), 0.5);
});

test('changing a day\'s status empties a figure the new status cannot take', { skip }, () => {
  assert.equal(box.deductionAfterStatusChange('HOLIDAY', '2'), '');
  assert.equal(box.deductionAfterStatusChange('PRESENT', '2'), '', 'two days is an absence\'s figure only');
  assert.equal(box.deductionAfterStatusChange('ABSENT_EXCUSED', '1'), '1');
  assert.equal(box.deductionAfterStatusChange('ABSENT', '2'), '2');
});

test('the help text says that zero means the rule on an absence and that a half day costs half a day unless another figure is typed', { skip }, () => {
  assert.match(box.deductionHelp('ABSENT'), /صفر.*يومين/);
  assert.match(box.deductionHelp('ABSENT_EXCUSED'), /صفر.*يوم/);
  assert.match(box.deductionHelp('HALF_DAY'), /بيتخصم نص يوم/);
});

test('the server takes a stale figure on a day that costs nothing as zero instead of refusing it', () => {
  assert.deepEqual(manualDayDeduction({ status: 'HOLIDAY', typed: 2, computed: 0 }), { days: 0 });
  assert.deepEqual(manualDayDeduction({ status: 'OVERTIME', typed: 5, computed: 0 }), { days: 0 });
  assert.ok(manualDayDeduction({ status: 'PRESENT', typed: 2, computed: 0 }).error, 'a worked day still costs a day at most');
  assert.deepEqual(manualDayDeduction({ status: 'ABSENT', typed: 0, computed: 0 }), { days: 0 }, 'a typed zero leaves the rule (two days) to payroll');
});
