'use strict';

// The screen's form of the payroll commission switch (10 Nov 2026): the browser's own functions, bundled, and what they send checked by the server's own rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bundle } = require('./support/repo');
const { normalizeCommissionSettings } = require('../lib/payrollCommission');

const form = bundle('admin/pages/dashboard/tabs/hr-sections/payrollCommissionForm.ts');
const skip = !form && 'admin dependencies are not installed';

test('nothing switched on is sent as off for everyone, and the server reads it the same', { skip }, () => {
  const built = form.toCommissionSettings({ team: { mode: 'OFF', rate: '' }, exceptions: [] });
  assert.deepEqual(built, { settings: { team: { mode: 'OFF', rate: 0 }, departments: {}, staff: {} } });
  assert.deepEqual(normalizeCommissionSettings(built.settings), built.settings);
});

test('the team\'s rule and the rules for a department and an employee survive a save and a reload', { skip }, () => {
  const typed = {
    team: { mode: 'PERCENT', rate: '2.5' },
    exceptions: [
      { scope: 'department', id: 'dep-sales', mode: 'RULES', rate: '' },
      { scope: 'staff', id: 'st-1', mode: 'OFF', rate: '7' },
      { scope: 'staff', id: 'st-2', mode: 'PERCENT', rate: '5' },
    ],
  };
  const built = form.toCommissionSettings(typed);
  assert.deepEqual(built.settings, {
    team: { mode: 'PERCENT', rate: 2.5 },
    departments: { 'dep-sales': { mode: 'RULES', rate: 0 } },
    staff: { 'st-1': { mode: 'OFF', rate: 0 }, 'st-2': { mode: 'PERCENT', rate: 5 } },
  });
  const stored = normalizeCommissionSettings(built.settings);
  assert.deepEqual(stored, built.settings, 'the server accepts exactly what the screen sends');
  assert.deepEqual(form.fromCommissionSettings(stored), {
    team: { mode: 'PERCENT', rate: '2.5' },
    exceptions: [
      { scope: 'department', id: 'dep-sales', mode: 'RULES', rate: '' },
      { scope: 'staff', id: 'st-1', mode: 'OFF', rate: '' },
      { scope: 'staff', id: 'st-2', mode: 'PERCENT', rate: '5' },
    ],
  });
});

test('a form that cannot be saved says why instead of sending it', { skip }, () => {
  const error = typed => form.toCommissionSettings(typed).error;
  assert.match(error({ team: { mode: 'PERCENT', rate: '' }, exceptions: [] }), /نسبة الفريق/);
  assert.match(error({ team: { mode: 'PERCENT', rate: '150' }, exceptions: [] }), /نسبة الفريق/);
  assert.match(error({ team: { mode: 'OFF', rate: '' }, exceptions: [{ scope: 'staff', id: '', mode: 'RULES', rate: '' }] }), /اختر الموظف/);
  assert.match(error({ team: { mode: 'OFF', rate: '' }, exceptions: [{ scope: 'department', id: 'd', mode: 'PERCENT', rate: '0' }] }), /قاعدة القسم/);
  assert.match(error({ team: { mode: 'OFF', rate: '' }, exceptions: [{ scope: 'staff', id: 's', mode: 'RULES', rate: '' }, { scope: 'staff', id: 's', mode: 'OFF', rate: '' }] }), /متكرر/);
});
