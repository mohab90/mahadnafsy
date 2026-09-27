'use strict';
// «زرار الأقساط مش موجود او مش شغال».
//
// Three things stood between the desk and a plan: writes were off unless an env
// flag production never set, so every plan was refused (0 ever created); the
// subscriber lists read plans from crm_json, not installment_plans, so a plan
// could never show in «الأقساط»; and no screen had a button to make one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installmentPlansBySubscriber, withInstallmentPlans } = require('../lib/installmentPlansBySubscriber');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('each subscriber gets their plans from the table, in the shape the table column reads', async () => {
  const db = { async query(sql, params) {
    assert.match(sql, /FROM installment_plans ip/);
    assert.deepEqual(params, ['t', 's1', 's2']);
    return [[{
      id: 'ip-1', subscriber_id: 's1', course_id: null, bundle_id: 'b-9', title: 'مسار', total_amount: 9000, currency: 'EGP',
      installments_count: 3, installment_amounts: '[3000,3000,3000]', due_dates: '["2026-10-01","2026-11-01","2026-12-01"]',
      paid_dates: '["2026-10-01",null,null]', paid_amounts: '[3000,null,null]', notes: null, created_at: '2026-09-27', course_title: 'مسار المعالج',
    }]];
  } };
  const plans = await installmentPlansBySubscriber('t', ['s1', 's2', 's1'], db);
  const [plan] = plans.get('s1');
  assert.equal(plan.courseId, 'bundle:b-9');
  assert.equal(plan.courseTitle, 'مسار المعالج');
  assert.deepEqual(plan.entries.map(entry => [entry.dueDate, entry.amount, entry.paidAt || null]),
    [['2026-10-01', 3000, '2026-10-01'], ['2026-11-01', 3000, null], ['2026-12-01', 3000, null]]);
  assert.equal(plans.has('s2'), false);
  // Table plans win; the one client with a plan only in crm_json keeps it.
  assert.deepEqual(withInstallmentPlans({ a: 1, installmentPlans: ['old'] }, [plan]).installmentPlans, [plan]);
  assert.deepEqual(withInstallmentPlans({ installmentPlans: ['old'] }, undefined).installmentPlans, ['old']);
});

test('every subscriber list reads them', () => {
  const lists = read('api/routes/admin/stafflists.js');
  assert.equal((lists.match(/const plansBySub = await installmentPlansBySubscriber\(req\.tenantId, ids\);/g) || []).length, 5);
  assert.equal((lists.match(/withInstallmentPlans\(parseCrm\(r\.crm_json\), plansBySub\.get\(r\.id\)\)/g) || []).length, 5);
});

test('an instalment is paid into a real box, and the reminder reads the table on Cairo\'s day', () => {
  const routes = read('api/routes/installments.js');
  assert.match(routes, /if \(!method\) return res\.status\(400\)\.json\(\{ error: 'paymentMethod is required' \}\);/);
  assert.match(routes, /payType, method,/);
  assert.doesNotMatch(routes, /payType, 'installment',/);
  const jobs = read('api/lib/scheduledJobHandlers.js');
  assert.match(jobs, /const target = addDaysToDateOnly\(cairoToday\(\), 3\);/);
  assert.match(jobs, /installmentPlansBySubscriber\(tenantId, ids, pool\)/);
});

test('the online table has a «الأقساط» button that opens the plans', () => {
  const table = read('admin/pages/dashboard/tabs/online-clients-sections/ClientsTable.tsx');
  assert.match(table, /<button title="الأقساط" onClick=\{\(\)=>setInstallmentsRow\(row\)\}/);
  const modal = read('admin/pages/dashboard/tabs/online-clients-sections/InstallmentPlansModal.tsx');
  assert.match(modal, /installment-plans\/\$\{paying\.planId\}\/entries\/\$\{paying\.index\}\/pay/);
  assert.match(modal, /paymentMethod: paying\.box/);
});
