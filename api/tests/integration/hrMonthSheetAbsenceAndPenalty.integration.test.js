'use strict';
/**
 * The month sheet's absence kinds and the manager's penalty, as they behave on a real MariaDB (these were regular expressions over routes/hr/attendance.js
 * and routes/hr/compensation.js): an absence is told apart on the day — without permission, excused, a free day, or spent from the leave balance — and
 * «من الرصيد» is refused once the 21 days are gone; a penalty is an amount or days at a thirtieth of the salary (not both), needs a reason, is never one's own,
 * and waits for approval unless the owner gave it. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-sheet-it';
let pool; let attendance; let compensation; let payroll;

const HR = { id: 'st-sh-hr', name: 'الموارد', role: 'hr', permissions_json: '["manage_hr","view_hr"]' };

async function call(router, method, path, { params = {}, body = {}, query = {} } = {}) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method} ${path}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params, body, query, headers: {}, tenantId: T, user: { uid: 'u', email: 'hr-sh@example.test' }, staffRecord: HR, isSuperAdmin: true, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

async function clean() {
  for (const table of ['attendance_logs', 'leaves', 'employee_bonuses', 'audit_events', 'hr_policy_versions', 'salary_structures', 'staff']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
}
const mark = (date, status, staffId = 'st-sh-emp') => call(attendance, 'post', '/api/admin/hr/attendance', { body: { staff_id: staffId, date, status } });
const dayRow = async (date, staffId = 'st-sh-emp') => (await pool.query('SELECT status, permit_used FROM attendance_logs WHERE tenant_id=? AND staff_id=? AND date=?', [T, staffId, date]))[0][0];
const penalty = body => call(compensation, 'post', '/api/admin/hr/month-penalties', { body: { month: 11, year: 2026, staffId: 'st-sh-emp', ...body } });

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  attendance = require('../../routes/hr/attendance');
  compensation = require('../../routes/hr/compensation');
  payroll = require('../../routes/hr/payroll');
  await clean();
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, base_salary) VALUES
       (?, ?, 'الموارد', 'hr-sh@example.test', '1012340701', 'HR', 1, '2024-01-01', 0),
       ('st-sh-emp', ?, 'موظفة', 'emp-sh@example.test', '1012340702', 'SALES', 1, '2024-01-01', 3000),
       ('st-sh-nosalary', ?, 'بلا راتب', 'ns-sh@example.test', '1012340703', 'SALES', 1, '2024-01-01', 0),
       ('st-sh-struct', ?, 'بهيكل راتب', 'st-sh@example.test', '1012340704', 'SALES', 1, '2024-01-01', 3000)`, [HR.id, T, T, T, T]);
  // The file says 3,000 but an approved structure covers every month of 2026 at 6,000: the payroll run pays on the structure.
  await pool.query(
    `INSERT INTO salary_structures (id, tenant_id, staff_id, base_salary, currency, status, effective_from)
     VALUES ('ss-sh-struct', ?, 'st-sh-struct', 6000, 'EGP', 'APPROVED', '2026-01-01')`, [T]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('an absence is told apart on the day: without permission, excused, a free day, or from the leave balance', { skip }, async () => {
  assert.equal((await mark('2026-11-01', 'ABSENT')).statusCode, 200);
  assert.deepEqual({ ...(await dayRow('2026-11-01')) }, { status: 'ABSENT', permit_used: null });
  assert.equal((await mark('2026-11-02', 'ABSENT_EXCUSED')).statusCode, 200);
  assert.deepEqual({ ...(await dayRow('2026-11-02')) }, { status: 'ABSENT', permit_used: 'excused' });
  assert.equal((await mark('2026-11-03', 'FREE_DAY')).statusCode, 200);
  assert.deepEqual({ ...(await dayRow('2026-11-03')) }, { status: 'HOLIDAY', permit_used: 'free_day' });
  assert.equal((await mark('2026-11-04', 'LEAVE_BALANCE')).statusCode, 200);
  assert.deepEqual({ ...(await dayRow('2026-11-04')) }, { status: 'HOLIDAY', permit_used: 'leave_balance' });
  assert.equal((await mark('2026-11-05', 'SICK')).statusCode, 400, 'a status that is not one');
});

test('«من الرصيد» is refused once the leave balance is gone', { skip }, async () => {
  // 21 days of entitlement: 20 approved annual days already spent, one left in November's marks above (1 balance day), so spend what is left.
  await pool.query(
    "INSERT INTO leaves (id, tenant_id, staff_id, type, start_date, end_date, total_days, status) VALUES ('lv-sh-1', ?, 'st-sh-emp', 'ANNUAL', '2026-03-01', '2026-03-20', 20, 'APPROVED')", [T]);
  const refused = await mark('2026-11-08', 'LEAVE_BALANCE');
  assert.equal(refused.statusCode, 409, JSON.stringify(refused.body));
  assert.equal(refused.body.code, 'LEAVE_BALANCE_EMPTY');
  assert.equal(await dayRow('2026-11-08'), undefined, 'no row was written');
});

test('a manager\'s penalty is an amount or days at a thirtieth, with a reason, never one\'s own, and waits for approval', { skip }, async () => {
  assert.equal((await penalty({ amount: 100 })).statusCode, 400, 'a reason is required');
  assert.equal((await penalty({ amount: 100, days: 1, reason: 'تأخير' })).statusCode, 400, 'an amount or days, not both');
  assert.equal((await penalty({ reason: 'تأخير' })).statusCode, 400, 'one of them');
  assert.equal((await penalty({ amount: -5, reason: 'تأخير' })).statusCode, 400);
  assert.equal((await penalty({ days: 2, reason: 'تأخير', staffId: 'st-sh-nosalary' })).statusCode, 409, 'days of nothing');
  const self = await penalty({ amount: 100, reason: 'تأخير', staffId: HR.id });
  assert.equal(self.statusCode, 409);
  assert.equal(self.body.code, 'HR_SELF_MUTATION');
  const byDays = await penalty({ days: 2, reason: 'غياب' });
  assert.equal(byDays.statusCode, 200, JSON.stringify(byDays.body));
  assert.equal(byDays.body.amount, 200, 'two days of a 3,000 salary at a thirtieth');
  assert.equal(byDays.body.status, 'PENDING', 'and a second person decides');
  const [[row]] = await pool.query('SELECT type, source, status, for_month, for_year FROM employee_bonuses WHERE id=?', [byDays.body.id]);
  assert.deepEqual({ ...row }, { type: 'deduction', source: 'MANAGER_PENALTY', status: 'PENDING', for_month: 11, for_year: 2026 });
});

test('the deduction typed on an absent day is kept — half a day, one, or two — and is what the month charges', { skip }, async () => {
  const absent = (date, deduction_days, status = 'ABSENT') => call(attendance, 'post', '/api/admin/hr/attendance', { body: { staff_id: 'st-sh-emp', date, status, deduction_days } });
  const stored = async date => Number((await pool.query('SELECT deduction_days FROM attendance_logs WHERE tenant_id=? AND staff_id=? AND date=?', [T, 'st-sh-emp', date]))[0][0].deduction_days);
  for (const [date, typed] of [['2026-12-06', 2], ['2026-12-07', 0.5], ['2026-12-08', 1]]) {
    const saved = await absent(date, typed);
    assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
    assert.equal(await stored(date), typed, `${typed} on ${date}`);
  }
  assert.equal((await absent('2026-12-09', '')).statusCode, 200, 'left blank: the rule decides');
  assert.equal(await stored('2026-12-09'), 0);
  assert.equal((await absent('2026-12-10', 2.5)).statusCode, 400, 'more than the two days an absence can cost');
  assert.equal((await absent('2026-12-10', 2, 'PRESENT')).statusCode, 400, 'a day that was worked costs a day at most');
  // Typed again, the day's figure is replaced, not added.
  assert.equal((await absent('2026-12-07', 1)).statusCode, 200);
  assert.equal(await stored('2026-12-07'), 1);
  assert.equal((await absent('2026-12-07', 0.5)).statusCode, 200);

  const summary = await call(payroll, 'get', '/api/admin/hr/attendance/summary', { query: { month: '12', year: '2026' } });
  assert.equal(summary.statusCode, 200, JSON.stringify(summary.body));
  const line = (Array.isArray(summary.body) ? summary.body : summary.body.rows || summary.body.staff).find(row => row.id === 'st-sh-emp');
  assert.equal(Number(line.absent_days), 4);
  assert.equal(Number(line.absence_charged_days), 5.5, 'two + a half + one typed, and two for the day left to the rule');
  assert.equal(Number(line.deduction_days), 0, 'an absence is not charged a second time as lateness');
});

test('a penalty in days is priced at the salary the payroll run uses: the approved structure, not the file basic salary', { skip }, async () => {
  const onStructure = await penalty({ days: 1, reason: 'غياب', staffId: 'st-sh-struct' });
  assert.equal(onStructure.statusCode, 200, JSON.stringify(onStructure.body));
  assert.equal(onStructure.body.amount, 200, 'a thirtieth of the structure 6,000, not of the file 3,000 (which would be 100)');
  const beforeStructure = await penalty({ days: 1, reason: 'غياب', staffId: 'st-sh-struct', year: 2025 });
  assert.equal(beforeStructure.body.amount, 100, 'a month no structure covers falls back to the file salary');
});

test('the month sheet\'s attended days are the days the payroll run counts: remote and a half day too', { skip }, async () => {
  const put = (date, status) => call(attendance, 'post', '/api/admin/hr/attendance', { body: { staff_id: 'st-sh-emp', date, status } });
  for (const [date, status] of [['2027-02-01', 'PRESENT'], ['2027-02-02', 'LATE'], ['2027-02-03', 'REMOTE'], ['2027-02-04', 'HALF_DAY'], ['2027-02-07', 'ABSENT']]) {
    assert.equal((await put(date, status)).statusCode, 200, `${status} on ${date}`);
  }
  const summary = await call(payroll, 'get', '/api/admin/hr/attendance/summary', { query: { month: '2', year: '2027' } });
  const line = summary.body.find(row => row.id === 'st-sh-emp');
  assert.strictEqual(line.present_days, 3.5, 'present + late + remote + half a day, as payroll counts them (it was 2)');
});

test('a bonus typed for a month or currency that does not exist is refused, not saved to never be paid', { skip }, async () => {
  const add = body => call(compensation, 'post', '/api/admin/hr/employees/:staffId/bonuses', { params: { staffId: 'st-sh-emp' }, body: { type: 'bonus', amount: 100, for_month: 11, for_year: 2026, ...body } });
  assert.equal((await add({ for_month: 13 })).statusCode, 400);
  assert.equal((await add({ for_year: 1999 })).statusCode, 400);
  assert.equal((await add({ currency: 'XYZ' })).statusCode, 400);
  assert.equal((await add({ amount: 1e9 })).statusCode, 400);
  assert.equal((await add({ currency: 'egp' })).statusCode, 200, 'a lower-case currency is read as EGP');
});
