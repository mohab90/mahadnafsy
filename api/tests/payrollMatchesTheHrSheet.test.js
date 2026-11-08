'use strict';
/**
 * The system's payroll arithmetic (lib/payrollCalc.js) against the HR sheet's own formulas (8 Nov 2026). The owner's real sheet (every month from February
 * 2025 to September 2026, 762 employee-months) agreed to the piastre except four rows the sheet itself left blank, zeroed or typed by hand; it stays off the
 * repository. These rows are made up, one per rule, and their net is worked out here with the sheet's formulas, cell for cell:
 *
 *   L (late)      = (H/G/F)·I + (H/G/F)·J + (H/G/F)·K           — hours late at salary ÷ 30 ÷ 8
 *   O (absence)   = (H/G)·M + (H/G)·N·2                          — a day with permission, a day without it twice
 *   T (other)     = P + Q + R + S                                — advance, deductions, insurance, penalties
 *   Y (overtime)  = (H/G/F)·V + (H/G/F)·W·1.5 + (H/G/F)·X         — the sheet's «×2» column is multiplied by 1 (its own formula)
 *   AE (net)      = H − (L + O + T) + (Y + Z + AA)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compareTab } = require('../tools/compare-payroll-sheet.cjs');

const HEAD = ['م', 'اسم الموظف', 'الوظيفه', 'الادارة', 'تارخ التعين', 'عدد ساعات العمل', 'عدد ايام الحضور', 'الراتب الاساسى', 'نسيان بصمة', 'تاخير بصمة',
  'خصم اذن وتاخير', 'القيمة', 'اجازه بخصم', 'اجازه *2', 'القيمة', 'سلف', 'خصم مكالمات او تارجيت', 'تامين', 'جزاءات', 'القيمه', 'اجمالى الاستقطاعات',
  'اوفر تايم بـ1', 'اوفر تايم بـ1.5', 'اوفر تايم بـ2', 'اجمالي الاوفر تايم', 'حافز', 'بدلات', 'اجمالى الاستحقاقات', 'اذن مفوع الاجر', 'اجازه مدفوعه الاجر', 'صافى الراتب'];

/** One row as the sheet computes it. */
function sheetRow(no, name, { H, F = 8, G = 30, I = 0, J = 0, K = 0, M = 0, N = 0, P = 0, Q = 0, R = 0, S = 0, V = 0, W = 0, X = 0, Z = 0, AA = 0 }) {
  const hourly = H / G / F;
  const L = hourly * I + hourly * J + hourly * K;
  const O = (H / G) * M + (H / G) * N * 2;
  const T = P + Q + R + S;
  const U = T + O + L;
  const Y = hourly * V + hourly * W * 1.5 + hourly * X;
  const AB = Y + Z + AA;
  const AE = H - U + AB;
  return [no, name, 'tele sales', 'المبيعات', 45000, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V, W, X, Y, Z, AA, AB, 0, 0, AE];
}

const MONTH = {
  name: 'شهر 9 -2026',
  rows: [
    HEAD,
    sheetRow(1, 'موظف التأخير', { H: 6600, I: 2, J: 4, K: 2 }),
    sheetRow(2, 'موظف الغياب بإذن', { H: 5000, M: 2 }),
    sheetRow(3, 'موظف الغياب من غير إذن', { H: 4500, N: 1, M: 1 }),
    sheetRow(4, 'موظف السلفة والتأمين', { H: 10000, P: 1000, R: 500, J: 2, K: 2 }),
    sheetRow(5, 'موظف الجزاءات والتارجت', { H: 5750, Q: 33, S: 250, J: 16 }),
    sheetRow(6, 'موظف الأوفر تايم', { H: 5750, V: 12, W: 2, Z: 300, AA: 100 }),
    sheetRow(7, 'موظف كسور القرش', { H: 5500, I: 8, J: 50, K: 2, N: 1, S: 46 }),
    ['', 'اجمالي فرع الدقي', '', '', '', '', '', 18750],
  ],
};

test('every employee\'s net by the system\'s payroll is the sheet\'s, to the piastre; a branch total is not an employee', () => {
  const result = compareTab(MONTH);
  assert.equal(result.employees, 7);
  assert.deepEqual(result.differing, [], JSON.stringify(result.differing));
});

test('a late or absent day costs the same as on the sheet: an hour is salary ÷ 30 ÷ 8, a day without permission two days', () => {
  const result = compareTab(MONTH).results;
  assert.equal(result.find(row => row.name === 'موظف التأخير').system, 6380, '6,600 − 8 hours × 27.5');
  assert.equal(result.find(row => row.name === 'موظف الغياب بإذن').system, 4666.67, '5,000 − 2 days × 166.67');
  assert.equal(result.find(row => row.name === 'موظف الغياب من غير إذن').system, 4050, '4,500 − (1 + 1 × 2) days × 150');
});

test('a net the sheet got wrong is named, as is one it left blank', () => {
  const wrong = { ...MONTH, rows: MONTH.rows.map(row => [...row]) };
  wrong.rows[2][30] = 4700;
  wrong.rows[3][30] = null;
  const result = compareTab(wrong);
  assert.deepEqual(result.differing.map(row => [row.name, row.diff]), [['موظف الغياب بإذن', -33.33], ['موظف الغياب من غير إذن', null]]);
});
