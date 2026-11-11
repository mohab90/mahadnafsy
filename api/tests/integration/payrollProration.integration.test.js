'use strict';
/**
 * 11 Nov 2026, the owner: «الموظف بيتحاسب على الأيام اللي حضرها فقط» — someone who joined or left during the month is paid a thirtieth of the salary for each calendar day
 * he belonged to (capped at thirty), allowances pro-rated the same way; absences and lateness are charged within those days only; one who left during the month is in that
 * month's run, one who left before it is not; no hire date means the full month and a warning. Real MariaDB, the real calculate handler and attendance summary.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-proration-it';
let pool; let router; let payslipBreakdown;

async function clean() {
  await pool.query('DELETE FROM payroll_items WHERE tenant_id=?', [T]).catch(() => {});
  for (const table of ['payroll_runs', 'payroll_period_locks', 'attendance_logs', 'salary_structures', 'staff']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
}
const handler = (method, path) => router.stack.find(l => l.route?.path === path && l.route.methods[method]).route.stack.at(-1).handle;
async function call(method, path, { body = {}, query = {} } = {}) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } };
  await handler(method, path)({ params: {}, query, body, headers: {}, tenantId: T, user: { uid: 'hr-calc', email: 'hr-calc@example.test' }, staffRecord: null, isSuperAdmin: true, ip: '1', get: () => undefined }, res);
  return res;
}
const calculate = (month, year) => call('post', '/api/admin/hr/payroll/calculate', { body: { month, year, skip_missing_salary: true } });
const item = (res, id) => res.body.items.find(i => i.staff_id === id);
const details = row => (typeof row.calculation_details === 'string' ? JSON.parse(row.calculation_details) : row.calculation_details);
const absent = (staff, date) => pool.query("INSERT INTO attendance_logs (id, tenant_id, staff_id, date, status, source) VALUES (UUID(), ?, ?, ?, 'ABSENT', 'MANUAL_ENTRY')", [T, staff, date]);

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/hr/payroll');
  ({ payslipBreakdown } = require('../../lib/payslipBreakdown'));
  await clean();
  const insert = (id, hire, term, active, salary = 3000) => pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, hire_date, termination_date, base_salary, branch_id)
     VALUES (?, ?, ?, ?, ?, 'SALES', ?, '2024-01-01', ?, ?, ?, 'branch-daqqi')`, [id, T, id, `${id}@x.t`, `10199${String(id.length).padStart(2, '0')}${Math.floor(Math.random() * 1e5)}`, active, hire, term, salary]);
  await insert('pj-join16', '2027-06-16', null, 1);
  await insert('pj-left10', '2025-01-01', '2027-06-10', 0);
  await insert('pj-both', '2027-06-05', '2027-06-20', 0);
  await insert('pj-full', '2025-01-01', null, 1);
  await insert('pj-leaves-next-month', '2025-01-01', '2027-07-05', 1);
  await insert('pj-left-before', '2025-01-01', '2027-05-20', 0);
  await insert('pj-no-hire-date', null, null, 1);
  await insert('pj-not-yet', '2027-07-03', null, 1);
  await insert('pj-feb-join', '2027-02-16', null, 1);
  await insert('pj-feb-first', '2027-02-01', null, 1);
  await pool.query(
    `INSERT INTO salary_structures (id, tenant_id, staff_id, base_salary, housing_allowance, currency, status, effective_from)
     VALUES ('ss-pj-join', ?, 'pj-join16', 3000, 600, 'EGP', 'APPROVED', '2026-01-01')`, [T]);
  // Days outside his employment are not absences: before the hire date, after the last day. One real absence inside it.
  await absent('pj-join16', '2027-06-10');
  await absent('pj-join16', '2027-06-20');
  await absent('pj-left10', '2027-06-08');
  await absent('pj-left10', '2027-06-15');
  await absent('pj-both', '2027-06-04');
  await absent('pj-both', '2027-06-25');
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('joined on the 16th: 15 of 30 days of the basic salary and the allowances, an absence only from his first day', { skip }, async () => {
  const june = await calculate(6, 2027);
  assert.equal(june.statusCode, 200, JSON.stringify(june.body));
  const row = item(june, 'pj-join16');
  assert.equal(row.base_salary, 1500, '15 calendar days (16th to 30th) of 3,000 at a thirtieth');
  assert.equal(row.total_allowances, 300, 'the 600 housing allowance for the same 15 days');
  // The absence on the 20th costs two days at the whole salary's thirtieth (100); the one on the 10th was before he joined.
  assert.equal(row.absence_deductions, 200);
  assert.equal(row.net_salary, 1500 + 300 - 200);
  const slip = payslipBreakdown({ ...row, calculation_details: row.calculation_details }, [], 'APPROVED');
  assert.deepEqual(slip.proration, { paidDays: 15, monthDays: 30, fromDay: 16, toDay: null, fullBase: 3000 });
  assert.equal(slip.base, 1500, 'the payslip shows the pro-rated basic');
});

test('left on the 10th: in that month\'s run for his 10 days; a month later he is not; joined and left inside the month', { skip }, async () => {
  const june = await calculate(6, 2027);
  const left = item(june, 'pj-left10');
  assert.ok(left, 'a deactivated employee whose last day is in the month is paid his days');
  assert.equal(left.base_salary, 1000);
  assert.equal(left.absence_deductions, 200, 'the 8th counts, the 15th is after he left');
  assert.deepEqual(details(left).proration, { partial: true, paidDays: 10, monthDays: 30, fromDay: null, toDay: 10, fullBase: 3000, noHireDate: false });
  const both = item(june, 'pj-both');
  assert.equal(both.base_salary, 1600, '5th to 20th is 16 days');
  assert.equal(both.absence_deductions, 0, 'the 4th and the 25th are outside the days he belonged to');
  assert.equal(item(june, 'pj-left-before'), undefined, 'left in May: not in June');
  const july = await calculate(7, 2027);
  assert.equal(item(july, 'pj-left10'), undefined, 'left in June: not in July');
  assert.equal(item(july, 'pj-both'), undefined);
  assert.equal(item(july, 'pj-leaves-next-month').base_salary, 3000 * 5 / 30, 'his last day is the 5th of July');
  assert.equal(item(july, 'pj-not-yet').base_salary, 2900, 'hired on the 3rd of July: the 29 calendar days from the 3rd');
});

test('joined before and left after: the full month; no hire date: the full month and named in the warnings', { skip }, async () => {
  const june = await calculate(6, 2027);
  assert.equal(item(june, 'pj-full').base_salary, 3000);
  assert.equal(item(june, 'pj-leaves-next-month').base_salary, 3000, 'leaving next month changes nothing this month');
  assert.equal(item(june, 'pj-no-hire-date').base_salary, 3000);
  assert.deepEqual(june.body.noHireDate.map(entry => entry.staffId), ['pj-no-hire-date']);
  assert.equal(item(june, 'pj-not-yet'), undefined, 'not hired until July: not in June\'s run');
  assert.equal(details(item(june, 'pj-full')).proration, null);
});

test('February: a full month is the whole salary (28 days is a month), a joiner on the 16th is paid 13 days', { skip }, async () => {
  const february = await calculate(2, 2027);
  assert.equal(item(february, 'pj-feb-first').base_salary, 3000, 'joined on the 1st: the whole month');
  assert.equal(item(february, 'pj-full').base_salary, 3000, 'February\'s 28 days are not 28/30 of the salary');
  assert.equal(item(february, 'pj-feb-join').base_salary, 1300, '16th to 28th is 13 days');
});

test('the month sheet reads the same days: the leaver is on it, the paid days are there for its estimate', { skip }, async () => {
  const summary = await call('get', '/api/admin/hr/attendance/summary', { query: { month: '6', year: '2027' } });
  assert.equal(summary.statusCode, 200, JSON.stringify(summary.body));
  const byId = Object.fromEntries(summary.body.map(row => [row.id, row]));
  assert.equal(byId['pj-join16'].paid_days, 15);
  assert.equal(byId['pj-join16'].hired_on, '2027-06-16');
  assert.equal(Number(byId['pj-join16'].absence_charged_days), 2, 'the absence before the hire date is not read');
  assert.equal(byId['pj-left10'].paid_days, 10);
  assert.equal(byId['pj-left10'].left_on, '2027-06-10');
  assert.equal(byId['pj-full'].paid_days, 30);
  assert.equal(byId['pj-left-before'], undefined);
  assert.equal(byId['pj-not-yet'], undefined);
});
