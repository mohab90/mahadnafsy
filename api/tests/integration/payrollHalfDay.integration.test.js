'use strict';
/**
 * 11 Nov 2026, the owner: «اه يخصم نص يوم من المرتب» — a half day costs half a day's pay (a thirtieth of the salary over two), on the payroll run, on the month sheet's
 * figures and therefore on the payslip. A figure typed on the day replaces the rule; a half day written by an approved leave keeps that leave's own rule (a permission
 * costs nothing, an unpaid half day costs half a day once — not twice). Real MariaDB, real route handlers.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-half-day-it';
let pool; let attendance; let payroll;

const HR = { id: 'st-hd-hr', name: 'الموارد', role: 'hr', permissions_json: '["manage_hr","view_hr"]' };

async function call(router, method, path, { params = {}, body = {}, query = {} } = {}) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method} ${path}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params, body, query, headers: {}, tenantId: T, user: { uid: 'u', email: 'hr-hd@example.test' }, staffRecord: HR, isSuperAdmin: true, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

async function clean() {
  await pool.query('DELETE FROM payroll_items WHERE tenant_id=?', [T]).catch(() => {});
  for (const table of ['payroll_runs', 'payroll_period_locks', 'attendance_logs', 'leaves', 'employee_bonuses', 'audit_events', 'hr_policy_versions', 'salary_structures', 'staff']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}
const day = (date, status, extra = {}) => call(attendance, 'post', '/api/admin/hr/attendance', { body: { staff_id: 'st-hd-emp', date, status, ...extra } });
const stored = async date => { const [[row]] = await pool.query('SELECT status, deduction_days, leave_id FROM attendance_logs WHERE tenant_id=? AND staff_id=? AND date=?', [T, 'st-hd-emp', date]); return row; };
const calculate = (month, year) => call(payroll, 'post', '/api/admin/hr/payroll/calculate', { body: { month, year, skip_missing_salary: true } });
const summary = async (month, year) => (await call(payroll, 'get', '/api/admin/hr/attendance/summary', { query: { month: String(month), year: String(year) } })).body.find(row => row.id === 'st-hd-emp');

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  attendance = require('../../routes/hr/attendance');
  payroll = require('../../routes/hr/payroll');
  await clean();
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, base_salary) VALUES
       (?, ?, 'الموارد', 'hr-hd@example.test', '1012340801', 'HR', 1, '2024-01-01', 0),
       ('st-hd-emp', ?, 'موظفة', 'emp-hd@example.test', '1012340802', 'SALES', 1, '2024-01-01', 3000)`, [HR.id, T, T]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('a half day costs half a day unless a figure is typed; a typed figure replaces the rule, a blank or a zero leaves it', { skip }, async () => {
  assert.equal((await day('2027-04-01', 'HALF_DAY')).statusCode, 200);
  assert.equal(Number((await stored('2027-04-01')).deduction_days), 0, 'blank is kept as the rule, not as a figure');
  assert.equal((await day('2027-04-02', 'HALF_DAY', { deduction_days: 0.25 })).statusCode, 200);
  assert.equal(Number((await stored('2027-04-02')).deduction_days), 0.25);
  assert.equal((await day('2027-04-04', 'HALF_DAY', { deduction_days: 0 })).statusCode, 200);
  assert.equal((await day('2027-04-05', 'HALF_DAY', { check_in: '11:30', check_out: '17:00' })).statusCode, 200);
  assert.equal(Number((await stored('2027-04-05')).deduction_days), 0, 'the lateness of a half day is not charged on top of it');
  assert.equal((await day('2027-04-06', 'HALF_DAY', { deduction_days: 1.5 })).statusCode, 400, 'a half day costs a day at most');

  const line = await summary(4, 2027);
  // 0.5 (blank) + 0.25 (typed) + 0.5 (typed zero = the rule) + 0.5 (late punches, still just the half day)
  assert.equal(Number(line.absence_charged_days), 1.75);
  assert.equal(Number(line.deduction_days), 0, 'not counted a second time as lateness');
  assert.equal(line.present_days, 2, 'four half days are two attended days');

  const run = await calculate(4, 2027);
  assert.equal(run.statusCode, 200, JSON.stringify(run.body));
  const item = run.body.items.find(entry => entry.staff_id === 'st-hd-emp');
  // A thirtieth of 3,000 is 100: 1.75 days.
  assert.equal(item.absence_deductions, 175);
  assert.equal(item.late_deductions, 0);
  assert.equal(item.net_salary, 3000 - 175);
});

test('a half day written by an approved permission costs nothing; an unpaid half day leave costs half a day once', { skip }, async () => {
  const request = body => call(attendance, 'post', '/api/admin/hr/leaves', { body: { staff_id: 'st-hd-emp', ...body } });
  const approve = id => call(attendance, 'put', '/api/admin/hr/leaves/:id/status', { params: { id }, body: { status: 'APPROVED' } });
  const permission = await request({ type: 'PERMISSION', start_date: '2027-05-03', end_date: '2027-05-03' });
  assert.equal(permission.statusCode, 200, JSON.stringify(permission.body));
  assert.equal((await approve(permission.body.id)).statusCode, 200);
  const row = await stored('2027-05-03');
  assert.equal(row.status, 'HALF_DAY');
  assert.ok(row.leave_id, 'the approved permission is behind the half day');
  // An unpaid half day: the leave's own rule charges it (unpaid_leave_days), the half-day rule must not charge it again.
  await pool.query("INSERT INTO leaves (id, tenant_id, staff_id, type, start_date, end_date, total_days, status) VALUES ('lv-hd-unpaid', ?, 'st-hd-emp', 'UNPAID', '2027-05-04', '2027-05-04', 0.5, 'APPROVED')", [T]);
  await pool.query("INSERT INTO attendance_logs (id, tenant_id, staff_id, date, status, source, leave_id) VALUES (UUID(), ?, 'st-hd-emp', '2027-05-04', 'HALF_DAY', 'MANUAL_ENTRY', 'lv-hd-unpaid')", [T]);
  // And one half day with no leave at all.
  assert.equal((await day('2027-05-05', 'HALF_DAY')).statusCode, 200);

  const line = await summary(5, 2027);
  assert.equal(Number(line.absence_charged_days), 0.5, 'only the half day with no leave behind it');
  const run = await calculate(5, 2027);
  const item = run.body.items.find(entry => entry.staff_id === 'st-hd-emp');
  // 100 a day: the half day with no leave 50, the unpaid half day 50, the permission 0.
  assert.equal(item.absence_deductions, 100);
  assert.equal(item.net_salary, 2900);
  assert.equal(line.present_days, 1.5, 'three half days are one and a half attended days');
});
