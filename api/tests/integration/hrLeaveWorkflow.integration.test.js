'use strict';
/**
 * The leave workflow as it behaves, on a real MariaDB (these rules were regular expressions over routes/hr/attendance.js, `LEAVE_SELF_APPROVAL`
 * next to a path): a request is PENDING; only HR moves it, and never for their own leave; an approval writes the attendance days (weekends
 * left out) tied to the leave; a cancellation takes them away again; the balance is checked on approval; a day that already has an attendance
 * record blocks it; and an approved leave's days cannot be overwritten by hand. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-leave-it';
let pool; let router;

const HR = { id: 'st-lv-hr', name: 'مدير الموارد', role: 'hr', permissions_json: '["manage_hr","view_hr"]' };
const EMPLOYEE = { id: 'st-lv-emp', name: 'منى الموظفة', role: 'sales', permissions_json: '["manage_hr","view_hr"]' };

async function call(method, path, { params = {}, body = {}, staff = HR } = {}) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method} ${path}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params, body, query: {}, headers: {}, tenantId: T, user: { uid: 'u', email: 'hr@example.test' }, staffRecord: staff, isSuperAdmin: true, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

async function clean() {
  for (const table of ['attendance_logs', 'leaves', 'audit_events', 'staff', 'hr_policy_versions', 'notifications']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}

const request = async (type, startDate, endDate) => {
  const res = await call('post', '/api/admin/hr/leaves', { body: { staff_id: EMPLOYEE.id, type, start_date: startDate, end_date: endDate } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body;
};
const status = (id, to, staff) => call('put', '/api/admin/hr/leaves/:id/status', { params: { id }, body: { status: to }, staff });
const days = async leaveId => (await pool.query('SELECT date, status FROM attendance_logs WHERE tenant_id=? AND leave_id=? ORDER BY date', [T, leaveId]))[0]
  .map(row => `${String(row.date).slice(0, 10)} ${row.status}`);

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/hr/attendance');
  await clean();
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES
       (?, ?, 'مدير الموارد', 'hr-lv@example.test', '1012340101', 'HR', 1, '2024-01-01'),
       (?, ?, 'منى الموظفة', 'emp-lv@example.test', '1012340102', 'SALES', 1, '2024-01-01')`, [HR.id, T, EMPLOYEE.id, T]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('only HR approves a leave, never the employee\'s own, and each state moves one legal way', { skip }, async () => {
  const { id } = await request('ANNUAL', '2026-11-09', '2026-11-11');
  const own = await status(id, 'APPROVED', EMPLOYEE);
  assert.equal(own.statusCode, 409);
  assert.equal(own.body.code, 'LEAVE_SELF_APPROVAL');
  assert.deepEqual(await days(id), [], 'nothing was written');
  assert.equal((await status(id, 'CANCELLED', HR)).statusCode, 409, 'a pending request is rejected or approved, not cancelled');
  assert.equal((await status(id, 'APPROVED', HR)).statusCode, 200);
  assert.equal((await status(id, 'APPROVED', HR)).statusCode, 409, 'approved stays approved: only a cancellation follows');
  assert.equal((await status(id, 'REJECTED', HR)).statusCode, 409);
});

test('an approval writes the working days tied to the leave, and cancelling takes exactly those away', { skip }, async () => {
  // Thursday 12 Nov to Sunday 15 Nov: Friday is the weekend of the default policy.
  const { id } = await request('ANNUAL', '2026-11-12', '2026-11-15');
  assert.equal((await status(id, 'APPROVED', HR)).statusCode, 200);
  const written = await days(id);
  assert.ok(written.length >= 2 && written.every(line => line.endsWith('LEAVE')), written.join());
  assert.ok(!written.some(line => line.startsWith('2026-11-13')), 'the weekend day is not marked');
  assert.equal((await status(id, 'CANCELLED', HR)).statusCode, 200);
  assert.deepEqual(await days(id), [], 'the days come back off the attendance sheet');
  const [[row]] = await pool.query('SELECT status FROM leaves WHERE id=?', [id]);
  assert.equal(row.status, 'CANCELLED');
});

test('a leave longer than what is left of the year is not approved', { skip }, async () => {
  const { id } = await request('ANNUAL', '2027-01-03', '2027-03-25');
  const res = await status(id, 'APPROVED', HR);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'LEAVE_BALANCE_EXCEEDED');
  assert.deepEqual(await days(id), []);
});

test('a day that already has an attendance record blocks the approval, and an approved leave\'s days cannot be typed over', { skip }, async () => {
  await pool.query("INSERT INTO attendance_logs (id, tenant_id, staff_id, date, status, source) VALUES (UUID(), ?, ?, '2026-12-14', 'PRESENT', 'MANUAL_ENTRY')", [T, EMPLOYEE.id]);
  const blocked = await request('ANNUAL', '2026-12-13', '2026-12-15');
  const refused = await status(blocked.id, 'APPROVED', HR);
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.body.code, 'ATTENDANCE_CONFLICT');

  const { id } = await request('ANNUAL', '2026-12-20', '2026-12-21');
  assert.equal((await status(id, 'APPROVED', HR)).statusCode, 200);
  const typed = await call('post', '/api/admin/hr/attendance', { body: { staff_id: EMPLOYEE.id, date: '2026-12-20', status: 'PRESENT', check_in: '09:00' } });
  assert.equal(typed.statusCode, 409, JSON.stringify(typed.body));
  assert.equal(typed.body.code, 'LEAVE_ATTENDANCE_LOCKED');
  assert.deepEqual(await days(id), ['2026-12-20 LEAVE', '2026-12-21 LEAVE'], 'the leave\'s days are as approved');
});

test('the HR policy and the staff branch the leave workflow stands on are in the schema a new server gets', { skip }, async () => {
  const has = async (table, column) => {
    const [[row]] = await pool.query('SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?', [table, column]);
    return Number(row.n) === 1;
  };
  assert.ok(await has('staff', 'branch_id'));
  assert.ok(await has('hr_policy_versions', 'weekend_days_json'));
  assert.ok(await has('leaves', 'policy_id'));
  assert.ok(await has('attendance_logs', 'leave_id'));
});

test('a leave approved after its day was marked absent replaces the absence; a punched day still blocks', { skip }, async () => {
  await pool.query(
    `INSERT INTO attendance_logs (id, tenant_id, staff_id, date, status, source) VALUES
       (UUID(), ?, ?, '2027-05-04', 'ABSENT', 'AUTO_ABSENCE'), (UUID(), ?, ?, '2027-05-05', 'ABSENT', 'MANUAL_ENTRY')`, [T, EMPLOYEE.id, T, EMPLOYEE.id]);
  const { id } = await request('SICK', '2027-05-04', '2027-05-05');
  assert.equal((await status(id, 'APPROVED', HR)).statusCode, 200, 'it was a 409 ATTENDANCE_CONFLICT with no way to clear the days');
  assert.deepEqual(await days(id), ['2027-05-04 LEAVE', '2027-05-05 LEAVE']);
  const [[left]] = await pool.query("SELECT COUNT(*) n FROM attendance_logs WHERE tenant_id=? AND staff_id=? AND status='ABSENT' AND date BETWEEN '2027-05-04' AND '2027-05-05'", [T, EMPLOYEE.id]);
  assert.equal(Number(left.n), 0, 'no absence is left charging those days');
  // Cancelling gives the days back as plain days, not as absences.
  assert.equal((await status(id, 'CANCELLED', HR)).statusCode, 200);
  assert.deepEqual(await days(id), []);
});

test('11 Nov 2026: an annual leave past the balance left after the free days is not refused — the approval carries a warning and HR decides', { skip }, async () => {
  const rows = Array.from({ length: 18 }, (_, i) => `(UUID(), '${T}', '${EMPLOYEE.id}', '2028-01-${String(i + 1).padStart(2, '0')}', 'HOLIDAY', 'free_day', 'MANUAL_ENTRY')`).join(',');
  await pool.query(`INSERT INTO attendance_logs (id, tenant_id, staff_id, date, status, permit_used, source) VALUES ${rows}`);
  const fits = await request('ANNUAL', '2028-06-11', '2028-06-13');
  const within = await status(fits.id, 'APPROVED', HR);
  assert.equal(within.statusCode, 200, 'three days fit exactly in the three that are left of the 21');
  assert.equal(within.body.warning, undefined, 'nothing to warn about');
  const tooLong = await request('ANNUAL', '2028-06-04', '2028-06-07');
  const past = await status(tooLong.id, 'APPROVED', HR);
  assert.equal(past.statusCode, 200, 'it is no longer refused: it was a 409 LEAVE_BALANCE_EXCEEDED');
  assert.deepEqual(past.body.warning, { code: 'LEAVE_BALANCE_LOW', remaining: 0, requested: 4, message: 'الرصيد المتبقي 0 يوم — الإجازة هتعدّي الرصيد' });
  assert.deepEqual(await days(tooLong.id), ['2028-06-04 LEAVE', '2028-06-05 LEAVE', '2028-06-06 LEAVE', '2028-06-07 LEAVE'], 'and its days are written');
});

test('the leaves of one type alone are still held to the allowance (the check that was always there)', { skip }, async () => {
  const huge = await request('ANNUAL', '2029-01-01', '2029-02-28');
  const refused = await status(huge.id, 'APPROVED', HR);
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.body.code, 'LEAVE_BALANCE_EXCEEDED');
});

test('11 Nov 2026: a morning permission and an evening permission on the same day do not clash; overlapping hours, or a leave on that day, still do', { skip }, async () => {
  const permit = (type, start_time, end_time, date = '2030-03-04') =>
    call('post', '/api/admin/hr/leaves', { body: { staff_id: EMPLOYEE.id, type, start_date: date, end_date: date, start_time, end_time } });
  const morning = await permit('LATE_PERMIT', '09:00', '10:30');
  assert.equal(morning.statusCode, 200, JSON.stringify(morning.body));
  const evening = await permit('EARLY_LEAVE', '15:00', '17:00');
  assert.equal(evening.statusCode, 200, `it was a 409 (the same day): ${JSON.stringify(evening.body)}`);
  assert.equal((await permit('EARLY_LEAVE', '16:00', '17:30')).statusCode, 409, 'hours that overlap the evening one');
  assert.equal((await permit('LATE_PERMIT', '10:00', '11:00')).statusCode, 409, 'hours that overlap the morning one');
  assert.equal((await permit('EARLY_LEAVE', '10:30', '12:00')).statusCode, 200, 'touching hours do not overlap');
  const fullDay = await call('post', '/api/admin/hr/leaves', { body: { staff_id: EMPLOYEE.id, type: 'SICK', start_date: '2030-03-04', end_date: '2030-03-04' } });
  assert.equal(fullDay.statusCode, 409, 'a leave on a day with permissions still conflicts');
  const leave = await call('post', '/api/admin/hr/leaves', { body: { staff_id: EMPLOYEE.id, type: 'SICK', start_date: '2030-03-05', end_date: '2030-03-05' } });
  assert.equal(leave.statusCode, 200);
  assert.equal((await permit('LATE_PERMIT', '09:00', '10:00', '2030-03-05')).statusCode, 409, 'and a permission on a leave day conflicts');
});

test('11 Nov 2026: a leave across New Year spends the days that fall in each year, not all of them in the year it starts', { skip }, async () => {
  const { leaveBalanceOf } = require('../../lib/leaveBalance');
  // 15 days already taken in 2031 and 18 in 2032: seven days started on 28 Dec 2031 would be 22 in 2031 (refused) if counted whole, but are 4 + 3.
  await pool.query(
    `INSERT INTO leaves (id, tenant_id, staff_id, type, start_date, end_date, total_days, status) VALUES
       ('lv-ny-2031', ?, ?, 'ANNUAL', '2031-03-02', '2031-03-20', 15, 'APPROVED'),
       ('lv-ny-2032', ?, ?, 'ANNUAL', '2032-03-01', '2032-03-24', 18, 'APPROVED')`, [T, EMPLOYEE.id, T, EMPLOYEE.id]);
  const crossing = await request('ANNUAL', '2031-12-28', '2032-01-04');
  const approved = await status(crossing.id, 'APPROVED', HR);
  assert.equal(approved.statusCode, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.warning, undefined, 'it fits in both years');
  assert.equal((await leaveBalanceOf(pool, { tenantId: T, staffId: EMPLOYEE.id, year: 2031, entitlement: 21 })).annualLeaveDays, 19, '15 + the 4 working days of 28-31 Dec');
  assert.equal((await leaveBalanceOf(pool, { tenantId: T, staffId: EMPLOYEE.id, year: 2032, entitlement: 21 })).annualLeaveDays, 21, '18 + the 3 working days of 1-4 Jan (Friday is the weekly day off)');
  // Another day in 2032 would pass the allowance of that year, and is refused on that year's own count.
  const more = await request('ANNUAL', '2032-05-02', '2032-05-02');
  const refused = await status(more.id, 'APPROVED', HR);
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.body.code, 'LEAVE_BALANCE_EXCEEDED');
});
