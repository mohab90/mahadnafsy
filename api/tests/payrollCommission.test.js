'use strict';

// The automatic sales commission of payroll (10 Nov 2026): off unless the owner switches it on, for the team, a department or one employee.
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCommissionSettings, commissionRuleFor, commissionOf } = require('../lib/payrollCommission');

test('nothing stored means nobody is paid an automatic commission', () => {
  const settings = normalizeCommissionSettings({});
  assert.deepEqual(settings, { team: { mode: 'OFF', rate: 0 }, departments: {}, staff: {} });
  const rule = commissionRuleFor(settings, { staffId: 'st-1', departmentId: 'dep-1' });
  assert.deepEqual(commissionOf(rule, { rules: { amt: 900, cnt: 3 }, sales: 40000 }), { amount: 0, count: null, source: 'off' });
  assert.deepEqual(normalizeCommissionSettings(null).team, { mode: 'OFF', rate: 0 });
});

test('the closest rule wins: the employee\'s own, then the department\'s, then the team\'s', () => {
  const settings = normalizeCommissionSettings({
    team: { mode: 'PERCENT', rate: 2 },
    departments: { 'dep-sales': { mode: 'RULES' }, 'dep-hr': { mode: 'OFF' } },
    staff: { 'st-star': { mode: 'PERCENT', rate: 5 }, 'st-none': { mode: 'OFF' } },
  });
  const ruleOf = (staffId, departmentId) => commissionRuleFor(settings, { staffId, departmentId });
  assert.deepEqual(ruleOf('st-star', 'dep-sales'), { mode: 'PERCENT', rate: 5 });
  assert.deepEqual(ruleOf('st-none', 'dep-sales'), { mode: 'OFF', rate: 0 }, 'one employee switched off inside a department that is on');
  assert.deepEqual(ruleOf('st-a', 'dep-sales'), { mode: 'RULES', rate: 0 });
  assert.deepEqual(ruleOf('st-b', 'dep-hr'), { mode: 'OFF', rate: 0 });
  assert.deepEqual(ruleOf('st-c', 'dep-other'), { mode: 'PERCENT', rate: 2 });
  assert.deepEqual(ruleOf('st-d', null), { mode: 'PERCENT', rate: 2 }, 'no department: the team\'s rule');
});

test('a rule pays the commission rows written at payment time, or a percentage of the month\'s sales', () => {
  assert.deepEqual(commissionOf({ mode: 'RULES', rate: 0 }, { rules: { amt: 900, cnt: 3 }, sales: 40000 }), { amount: 900, count: 3, source: 'crm_commissions' });
  assert.deepEqual(commissionOf({ mode: 'RULES', rate: 0 }, { sales: 40000 }), { amount: 0, count: 0, source: 'crm_commissions' }, 'no rows this month');
  assert.deepEqual(commissionOf({ mode: 'PERCENT', rate: 2.5 }, { rules: { amt: 900, cnt: 3 }, sales: 40000 }), { amount: 1000, count: null, source: 'percent_of_sales' });
  assert.equal(commissionOf({ mode: 'PERCENT', rate: 3.33 }, { sales: 1000.1 }).amount, 33.3, 'to the piastre');
  assert.equal(commissionOf({ mode: 'PERCENT', rate: 5 }, {}).amount, 0);
});

test('settings that make no sense are refused with what is wrong', () => {
  for (const raw of [
    { team: { mode: 'DOUBLE' } },
    { team: { mode: 'PERCENT' } },
    { team: { mode: 'PERCENT', rate: 0 } },
    { team: { mode: 'PERCENT', rate: 101 } },
    { staff: { 'st-1': { mode: 'PERCENT', rate: 'abc' } } },
    { departments: { '': { mode: 'RULES' } } },
  ]) {
    assert.throws(() => normalizeCommissionSettings(raw), error => error.statusCode === 400 && error.message.length > 0, JSON.stringify(raw));
  }
  // A rate left on a rule that is not a percentage is dropped, and the mode is read whatever its case.
  assert.deepEqual(normalizeCommissionSettings({ team: { mode: 'rules', rate: 9 } }).team, { mode: 'RULES', rate: 0 });
});
