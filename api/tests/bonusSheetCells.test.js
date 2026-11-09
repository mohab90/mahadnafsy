'use strict';

// The sentences of the month sheet's bonus columns (9 Nov 2026): the browser's own functions, bundled and called with figures the server sends.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bundle } = require('./support/repo');

const cells = bundle('admin/pages/dashboard/tabs/hr-sections/bonusSheetCells.ts');
const skip = !cells && 'admin dependencies are not installed';

const rounds = [
  { round: 1, label: '1–15', from: '2026-10-01', to: '2026-10-15', bookings: 11, amount: 1000, computedAmount: 1000, override: null },
  { round: 2, label: '16–31', from: '2026-10-16', to: '2026-10-31', bookings: 6, amount: 400, computedAmount: 0, override: { id: 'o1', amount: 400, reason: 'قرار الإدارة', by: 'المالك' } },
];
const plan = (patch = {}) => ({ scheme: 'SALES_BOOKINGS', schemeLabel: 'حجوزات (سيلز)', halfMonths: true, splitDay: 16, splitSource: 'default', rounds, collection: null, deskBonus: null, computedTotal: 1000, total: 1400, totalOverride: null, ...patch });

test('a round says the bookings it reached and what that paid', { skip }, () => {
  assert.equal(cells.roundCellText(rounds[0]), '11 حجز → 1,000');
  assert.equal(cells.roundCellText({ bookings: 9.5, amount: 0 }), '9.5 حجز → 0', 'half a booking counts half');
});

test('a collector has one sentence: the bonus with what was collected', { skip }, () => {
  assert.equal(cells.collectionCellText({ collected: 60000, amount: 1200, from: 50000 }), 'مكافأة 1,200 ج.م مع تحقيق 60,000 ج.م');
});

test('the total is the plan\'s month plus what was typed by hand, and an employee on no scheme has only the manual part', { skip }, () => {
  assert.equal(cells.bonusTotal(plan(), { manualApproved: 300, manualPending: 50 }), 1750);
  assert.equal(cells.bonusTotal(null, { manualApproved: 300 }), 300);
  assert.equal(cells.bonusTotal(null), 0);
});

test('where the plan\'s bonus stands towards payroll: not saved, saved but different, waiting, approved, or nothing to save', { skip }, () => {
  assert.equal(cells.saveState(plan(), null).kind, 'unsaved');
  assert.deepEqual(cells.saveState(plan(), { amount: 1000, approved: false }), { kind: 'differs', saved: 1000 });
  assert.equal(cells.saveState(plan(), { amount: 1400, approved: false }).kind, 'pending');
  assert.equal(cells.saveState(plan(), { amount: 1400, approved: true }).kind, 'approved');
  assert.equal(cells.saveState(plan({ total: 0 }), null).kind, 'none');
  assert.equal(cells.saveState(null, null).kind, 'none');
  for (const kind of ['unsaved', 'differs', 'pending']) assert.ok(cells.SAVE_STATE_TEXT[kind].length > 0, kind);
});
