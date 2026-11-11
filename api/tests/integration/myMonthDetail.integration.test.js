'use strict';
/**
 * 2 Nov 2026, «خلي كل موظف يشوف كل التفاصيل بتاعت الراتب بتاعه غيابات واذونات وغيره»: GET /api/staff/me/month-detail answers the signed-in employee's own
 * month — every judged day, the permissions and leave, the bonus with required and reached, the payslip once approved — and never another employee's.
 * 9 Nov 2026: the month's money — bonuses with their reasons, the payslip line by line — is answered only once management has APPROVED the month's payroll run: not a
 * pending bonus, not a calculated-but-unapproved run. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-my-month-it';
let pool, router;

async function clean() {
  for (const table of ['payroll_items', 'payroll_runs', 'employee_bonuses', 'leaves', 'attendance_logs', 'staff']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
  await pool.query('DELETE FROM tenants WHERE id=?', [T]).catch(() => {});
}
const handler = path => router.stack.find(l => l.route?.path === path && l.route.methods.get).route.stack.at(-1).handle;
async function detail(email, query = { month: 10, year: 2026 }) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } };
  await handler('/api/staff/me/month-detail')({ params: {}, query, body: {}, headers: {}, tenantId: T, user: { email }, ip: '1', get: () => undefined }, res);
  return res;
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/hr/compensation');
  await clean();
  await pool.query("INSERT INTO tenants (id, slug, name, status) VALUES (?, ?, 'My month IT', 'suspended')", [T, T]);
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES
       ('mm-sara', ?, 'سارة', 'mm1@x.t', '1018000001', 'SALES', 1, '2025-01-01'),
       ('mm-omar', ?, 'عمر', 'mm2@x.t', '1018000002', 'SALES', 1, '2025-01-01')`, [T, T]);
  await pool.query(
    `INSERT INTO attendance_logs (id, tenant_id, staff_id, date, check_in, check_out, late_minutes, early_leave_minutes, deduction_days, permit_used, status, source, review_flag) VALUES
       ('mm-a1', ?, 'mm-sara', '2026-10-01', '11:20:00', '18:35:00', 20, 0, 0.25, NULL, 'LATE', 'FINGERPRINT_IMPORT', NULL),
       ('mm-a2', ?, 'mm-sara', '2026-10-03', NULL, NULL, 0, 0, NULL, NULL, 'ABSENT', 'FINGERPRINT_IMPORT', NULL),
       ('mm-a3', ?, 'mm-sara', '2026-10-04', '12:30:00', '18:30:00', 90, 0, 0, 'morning', 'LATE', 'FINGERPRINT_IMPORT', NULL),
       ('mm-a4', ?, 'mm-sara', '2026-11-02', '11:00:00', '18:30:00', 0, 0, 0, NULL, 'PRESENT', 'FINGERPRINT_IMPORT', NULL),
       ('mm-b1', ?, 'mm-omar', '2026-10-01', '11:00:00', '18:30:00', 0, 0, 0, NULL, 'PRESENT', 'FINGERPRINT_IMPORT', NULL)`, [T, T, T, T, T]);
  await pool.query(
    `INSERT INTO leaves (id, tenant_id, staff_id, type, start_date, end_date, total_days, status, start_time, end_time) VALUES
       ('mm-l1', ?, 'mm-sara', 'LATE_PERMIT', '2026-10-04', '2026-10-04', 1, 'APPROVED', '11:00', '12:30'),
       ('mm-l2', ?, 'mm-omar', 'ANNUAL', '2026-10-10', '2026-10-11', 2, 'APPROVED', NULL, NULL)`, [T, T]);
  await pool.query(
    `INSERT INTO employee_bonuses (id, tenant_id, staff_id, type, amount, status, for_month, for_year, target_value, achieved_value, target_unit, source, reason) VALUES
       ('mm-b-sara', ?, 'mm-sara', 'bonus', 500, 'PENDING', 10, 2026, 20, 23, 'clients', 'MONTH_SHEET', 'حققت التارجت'),
       ('mm-b-omar', ?, 'mm-omar', 'bonus', 900, 'APPROVED', 10, 2026, NULL, NULL, NULL, NULL, NULL)`, [T, T]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('the employee sees every judged day of the month, the permission, the leave and the bonus with required and reached — and nothing of anyone else', { skip }, async () => {
  const { body, statusCode } = await detail('mm1@x.t');
  assert.equal(statusCode, 200);
  assert.deepEqual(body.days.map(d => d.date), ['2026-10-01', '2026-10-03', '2026-10-04'], 'only October, only hers');
  assert.deepEqual(body.days[0], {
    date: '2026-10-01', status: 'LATE', checkIn: '11:20', checkOut: '18:35', lateMinutes: 20, earlyLeaveMinutes: 0, deductionDays: 0.25, permit: null,
    flag: null, source: 'FINGERPRINT_IMPORT', onLeave: false, note: null,
  });
  assert.equal(body.days[2].permit, 'morning');
  assert.deepEqual(body.summary, { present: 2, absent: 1, lateDays: 2, lateMinutes: 110, deductionDays: 0.25, oneStamp: 0 });
  assert.deepEqual(body.leaves.map(l => [l.type, l.status, l.from, l.startTime, l.endTime]), [['LATE_PERMIT', 'APPROVED', '2026-10-04', '11:00', '12:30']]);
  assert.deepEqual(body.bonuses, [], 'a bonus still waiting for approval is not shown');
  assert.equal(body.payslip, null, 'no approved payroll for the month yet');
});

test('a calculated run that management has not approved shows no money either', { skip }, async () => {
  await pool.query("INSERT INTO payroll_runs (id, tenant_id, month, year, status, branch_id) VALUES ('mm-run-calc', ?, 10, 2026, 'CALCULATED', 'branch-calc')", [T]);
  await pool.query(
    `INSERT INTO payroll_items (id, payroll_run_id, staff_id, tenant_id, base_salary, total_allowances, commission, bonus, late_deductions, absence_deductions, advance_deductions, other_deductions, net_salary)
     VALUES ('mm-pi-calc', 'mm-run-calc', 'mm-sara', ?, 6000, 0, 0, 500, 0, 0, 0, 0, 6500)`, [T]);
  await pool.query("UPDATE employee_bonuses SET status='APPROVED' WHERE id='mm-b-sara'");
  const { body } = await detail('mm1@x.t');
  assert.deepEqual([body.payslip, body.bonuses], [null, []], 'approved bonus, calculated run: nothing yet');
  await pool.query("DELETE FROM payroll_items WHERE id='mm-pi-calc'");
  await pool.query("DELETE FROM payroll_runs WHERE id='mm-run-calc'");
  await pool.query("UPDATE employee_bonuses SET status='PENDING' WHERE id='mm-b-sara'");
});

test('the payslip appears once the month\'s payroll is approved, with every line', { skip }, async () => {
  await pool.query("INSERT INTO payroll_runs (id, tenant_id, month, year, status, branch_id) VALUES ('mm-run', ?, 10, 2026, 'APPROVED', 'branch-other')", [T]);
  await pool.query(
    `INSERT INTO payroll_items (id, payroll_run_id, staff_id, tenant_id, base_salary, total_allowances, commission, bonus, bonus_note, late_deductions, absence_deductions, advance_deductions, other_deductions, net_salary)
     VALUES ('mm-pi', 'mm-run', 'mm-sara', ?, 6000, 0, 300, 500, 'حققت التارجت', 75, 200, 0, 0, 6525)`, [T]);
  const { body } = await detail('mm1@x.t');
  assert.deepEqual(body.payslip, {
    status: 'APPROVED', base: 6000, allowances: 0, commission: 300, teachingFees: 0, overtime: 0, bonus: 500, bonusNote: 'حققت التارجت', lateDeduction: 75, absenceDeduction: 200,
    advanceDeduction: 0, advances: [], advanceOwedAfter: 0, proration: null, administrativeDeduction: 0, insuranceAndTax: 0, otherDeduction: 0, deductionsNote: null,
    bonusLines: [{ id: null, kind: 'plan', label: 'مكافآت أخرى اتحسبت في المسير', amount: 500, reason: 'حققت التارجت', currency: 'EGP' }], deductionLines: [], net: 6525,
  }, 'a bonus still pending when the run was calculated is said as the difference, so the lines add up');
  const other = (await detail('mm2@x.t')).body;
  assert.equal(other.payslip, null, 'another employee sees none of it');
  assert.deepEqual(other.leaves.map(l => l.type), ['ANNUAL']);
  assert.equal(other.days.length, 1);
});

test('an unknown month is refused and a stranger has no record', { skip }, async () => {
  assert.equal((await detail('mm1@x.t', { month: 13, year: 2026 })).statusCode, 400);
  assert.equal((await detail('nobody@x.t')).statusCode, 404);
});

test('once approved the payslip reads line by line: the rounds with their reasons, the manual bonus, the manager deduction, the net — and only the employee own', { skip }, async () => {
  await pool.query("DELETE FROM employee_bonuses WHERE id='mm-b-omar'");
  const calc = JSON.stringify({
    ladder: { bookings: 17, amount: 1400, rounds: [
      { round: 1, label: '1–15', bookings: 11, amount: 1000, computedAmount: 1000 },
      { round: 2, label: '16–31', bookings: 6, amount: 400, computedAmount: 0, override: { reason: 'قرار الإدارة' } }] },
  });
  await pool.query(
    `INSERT INTO employee_bonuses (id, tenant_id, staff_id, type, amount, status, for_month, for_year, source, reason, calc_json, currency) VALUES
       ('mm-plan', ?, 'mm-omar', 'bonus', 1400, 'APPROVED', 10, 2026, 'BONUS_PLAN', 'مكافأة شهر 10', ?, 'EGP'),
       ('mm-hand', ?, 'mm-omar', 'bonus', 300, 'APPROVED', 10, 2026, 'MONTH_SHEET', 'شغل إضافي في المعرض', NULL, 'EGP'),
       ('mm-pen', ?, 'mm-omar', 'deduction', 150, 'APPROVED', 10, 2026, 'MONTH_SHEET', 'مخالفة التعليمات', NULL, 'EGP'),
       ('mm-wait', ?, 'mm-omar', 'bonus', 999, 'PENDING', 10, 2026, 'MONTH_SHEET', 'لسه ما اتعتمدتش', NULL, 'EGP')`, [T, calc, T, T, T]);
  await pool.query(
    `INSERT INTO payroll_items (id, payroll_run_id, staff_id, tenant_id, base_salary, total_allowances, commission, bonus, late_deductions, absence_deductions, advance_deductions, other_deductions, net_salary, calculation_details)
     VALUES ('mm-pi2', 'mm-run', 'mm-omar', ?, 9000, 0, 0, 1700, 90, 300, 0, 150, 10160, '{"deductionTotal":150,"dedSocial":0,"dedTax":0,"overtimePay":0}')`, [T]);
  const { body } = await detail('mm2@x.t');
  const pay = body.payslip;
  assert.deepEqual([pay.base, pay.lateDeduction, pay.absenceDeduction, pay.administrativeDeduction, pay.net], [9000, 90, 300, 150, 10160]);
  assert.deepEqual(pay.bonusLines.map(line => [line.kind, line.label, line.amount, line.reason]), [
    ['round', 'مكافأة الروند الأول (1–15)', 1000, '11 حجز'],
    ['round', 'مكافأة الروند التاني (16–31)', 400, '6 حجز — اتعدلت من الإدارة: قرار الإدارة'],
    ['manual', 'مكافأة', 300, 'شغل إضافي في المعرض'],
  ]);
  assert.equal(pay.bonusLines.reduce((sum, line) => sum + line.amount, 0), pay.bonus, 'the lines add up to the bonus on the payslip');
  assert.deepEqual(pay.deductionLines.map(line => [line.label, line.amount, line.reason]), [['خصم إداري', 150, 'مخالفة التعليمات']]);
  assert.deepEqual(body.bonuses.map(b => b.id).sort(), ['mm-hand', 'mm-pen', 'mm-plan'], 'the one still waiting is not listed');
  const sara = (await detail('mm1@x.t')).body;
  assert.equal(JSON.stringify(sara).includes('mm-plan') || JSON.stringify(sara).includes('قرار الإدارة'), false, 'nothing of the other employee');
});
