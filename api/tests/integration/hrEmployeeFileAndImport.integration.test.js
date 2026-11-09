'use strict';
/**
 * The employee file and the attendance import as they behave, on a real MariaDB (these were regular expressions over routes/hr/employees.js and routes/hr/payroll.js):
 * nobody edits their own compensation or access; the permission grid and the data scope are a super administrator's to set and are refused loudly to anyone else;
 * an employee is switched off only through the offboarding workflow; an email change moves the sign-in with it and ends the old sessions; an unknown permission or a
 * commission above 100 is refused; and a CSV import writes the working days but never touches a day an approved leave holds, a date outside the month, or a bad time.
 * Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-empfile-it';
let pool; let employees; let payroll; let attendance;

const HR = { id: 'st-ef-hr', name: 'الموارد', role: 'hr', permissions_json: '["manage_hr","view_hr"]' };

async function call(router, method, path, { params = {}, body = {}, superAdmin = false, staff = HR } = {}) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method} ${path}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params, body, query: {}, headers: {}, tenantId: T, user: { uid: 'u-hr', email: 'hr-ef@example.test' }, staffRecord: staff, isSuperAdmin: superAdmin, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

async function clean() {
  for (const table of ['attendance_logs', 'attendance_import_batches', 'leaves', 'audit_logs', 'users', 'staff']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
}
const edit = (id, body, superAdmin = false, staff = HR) => call(employees, 'put', '/api/admin/hr/employees/:id', { params: { id }, body, superAdmin, staff });
const emp = async () => (await pool.query("SELECT email, commission_rate, permissions_json, is_active FROM staff WHERE id='st-ef-emp'"))[0][0];

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  employees = require('../../routes/hr/employees');
  payroll = require('../../routes/hr/payroll');
  attendance = require('../../routes/hr/attendance');
  await clean();
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, commission_rate) VALUES
       (?, ?, 'الموارد', 'hr-ef@example.test', '1012340901', 'HR', 1, '2024-01-01', 0),
       ('st-ef-emp', ?, 'منى المبيعات', 'old-ef@example.test', '1012340902', 'SALES', 1, '2024-01-01', 5)`, [HR.id, T, T]);
  await pool.query("INSERT INTO users (id, tenant_id, email, phone, password_hash, name, role, is_active, session_version) VALUES ('us-ef-1', ?, 'old-ef@example.test', NULL, 'x', 'منى المبيعات', 'user', 1, 1)", [T]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('nobody edits their own compensation or access, an employee is switched off only through offboarding, and absurd values are refused', { skip }, async () => {
  const self = await edit(HR.id, { commission_rate: 50 });
  assert.equal(self.statusCode, 409);
  assert.equal(self.body.code, 'HR_SELF_MUTATION');
  const off = await edit('st-ef-emp', { is_active: 0 });
  assert.equal(off.statusCode, 409);
  assert.equal(off.body.code, 'USE_OFFBOARDING_WORKFLOW');
  assert.equal(Number((await emp()).is_active), 1);
  assert.equal((await edit('st-ef-emp', { commission_rate: 150 })).statusCode, 400, 'above 100 percent');
  assert.equal((await edit('st-ef-emp', { commission_rate: -1 })).statusCode, 400);
  assert.equal((await edit('st-ef-emp', { email: 'not-an-email' })).statusCode, 400);
  assert.equal((await edit('st-ef-nobody', { notes: 'x' })).statusCode, 404);
  assert.equal(Number((await emp()).commission_rate), 5, 'nothing changed');
});

test('the permission grid and data scope are a super administrator\'s: refused loudly to HR, validated for the owner', { skip }, async () => {
  const refused = await edit('st-ef-emp', { permissions: ['view_leads'] });
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.body.code, 'PERMISSIONS_REQUIRE_SUPERADMIN');
  assert.equal((await emp()).permissions_json, null, 'the grid is as it was');
  assert.equal((await edit('st-ef-emp', { permissions: ['no_such_permission'] }, true)).statusCode, 400, 'an unknown permission');
  assert.equal((await edit('st-ef-emp', { permissions: 'oops' }, true)).statusCode, 400);
  const set = await edit('st-ef-emp', { permissions: ['view_leads', 'view_leads', 'manage_leads'] }, true);
  assert.equal(set.statusCode, 200, JSON.stringify(set.body));
  assert.deepEqual(JSON.parse((await emp()).permissions_json), ['view_leads', 'manage_leads'], 'stored once each');
  assert.equal((await edit('st-ef-emp', { permissions: [] }, true)).statusCode, 200);
  assert.equal((await emp()).permissions_json, '[]', 'an emptied grid is stored as none, not as «the role\'s own»');
});

test('changing the email moves the sign-in with it, ends the old sessions and leaves an audit event', { skip }, async () => {
  const before = (await pool.query("SELECT session_version FROM users WHERE id='us-ef-1'"))[0][0];
  const moved = await edit('st-ef-emp', { email: 'New-EF@Example.test' });
  assert.equal(moved.statusCode, 200, JSON.stringify(moved.body));
  assert.equal((await emp()).email, 'new-ef@example.test', 'lower-cased');
  assert.ok(before, 'the sign-in row exists');
  {
    const user = (await pool.query("SELECT email, session_version FROM users WHERE id='us-ef-1'"))[0][0];
    assert.equal(user.email, 'new-ef@example.test', 'the account follows the staff row');
    assert.ok(Number(user.session_version) > Number(before.session_version), 'the old sessions are ended');
  }
  const [events] = await pool.query("SELECT action FROM audit_logs WHERE tenant_id=? AND action='hr.employee.updated'", [T]);
  assert.ok(events.length >= 1);
});

test('a CSV import writes the working days but not a day an approved leave holds, a date outside the month, or a bad time', { skip }, async () => {
  const leave = await call(attendance, 'post', '/api/admin/hr/leaves', { body: { staff_id: 'st-ef-emp', type: 'ANNUAL', start_date: '2026-11-10', end_date: '2026-11-10' }, superAdmin: true });
  assert.equal(leave.statusCode, 200, JSON.stringify(leave.body));
  const approved = await call(attendance, 'put', '/api/admin/hr/leaves/:id/status', { params: { id: leave.body.id }, body: { status: 'APPROVED' }, superAdmin: true });
  assert.equal(approved.statusCode, 200, JSON.stringify(approved.body));
  const csv = [
    'employee_id,date,check_in,check_out',
    'st-ef-emp,2026-11-09,09:00,17:00',
    'st-ef-emp,2026-11-10,09:00,17:00',
    'st-ef-emp,2026-12-01,09:00,17:00',
    'st-ef-emp,2026-11-11,9am,17:00',
    'nobody,2026-11-12,09:00,17:00',
  ].join('\n');
  const res = await call(payroll, 'post', '/api/admin/hr/attendance/import', { body: { csv, month: 11, year: 2026, filename: 'nov.csv' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.imported, 1, 'only the first row is a day to write');
  const errors = JSON.stringify(res.body.errors || []);
  assert.match(errors, /approved leave attendance is locked/);
  assert.match(errors, /date must be inside 2026-11/);
  assert.match(errors, /time must use HH:mm/);
  assert.match(errors, /not found or ambiguous/);
  const rows = (await pool.query("SELECT DATE_FORMAT(date,'%Y-%m-%d') AS day, status FROM attendance_logs WHERE tenant_id=? AND staff_id='st-ef-emp' ORDER BY date", [T]))[0];
  assert.deepEqual(rows.map(row => [row.day, row.status]), [['2026-11-09', 'PRESENT'], ['2026-11-10', 'LEAVE']], 'the leave day is still the leave\'s');
});
