'use strict';
/**
 * 11 Nov 2026: "nobody sets their own pay or attendance" (HR_SELF_MUTATION) has one exception — the owner (ADMIN_EMAILS / ADMIN_UIDS, lib/hrSelfMutation.js). A manager or an
 * HR employee, even a super admin by role, is still refused. Checked on the helper itself and on the attendance entry (every other HR_SELF_MUTATION check calls the same helper).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_EMAILS = 'owner-self@example.test';
for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-default';
let pool; let attendance; let isSelfMutation;

const OWNER_STAFF = { id: 'st-own-owner', name: 'المالك', role: 'admin', permissions_json: '["manage_hr","view_hr"]' };
const MANAGER_STAFF = { id: 'st-own-manager', name: 'مدير', role: 'manager', permissions_json: '["manage_hr","view_hr"]' };

const asOwner = (staffRecord, extra = {}) => ({ user: { uid: 'u-owner', email: 'owner-self@example.test', tenant_id: T }, staffRecord, isSuperAdmin: true, tenantId: T, headers: {}, ip: '1', get: () => undefined, ...extra });
const asManager = (staffRecord, extra = {}) => ({ user: { uid: 'u-mgr', email: 'manager-self@example.test', tenant_id: T }, staffRecord, isSuperAdmin: true, tenantId: T, headers: {}, ip: '1', get: () => undefined, ...extra });

async function run(router, method, path, req) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method} ${path}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  ({ isSelfMutation } = require('../../lib/hrSelfMutation'));
  attendance = require('../../routes/hr/attendance');
  await pool.query("DELETE FROM attendance_logs WHERE tenant_id=? AND staff_id IN (?, ?)", [T, OWNER_STAFF.id, MANAGER_STAFF.id]);
  await pool.query("DELETE FROM staff WHERE tenant_id=? AND id IN (?, ?)", [T, OWNER_STAFF.id, MANAGER_STAFF.id]);
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, base_salary) VALUES
       (?, ?, 'المالك', 'owner-self@example.test', '1012340901', 'ADMIN', 1, '2024-01-01', 5000),
       (?, ?, 'مدير', 'manager-self@example.test', '1012340902', 'MANAGER', 1, '2024-01-01', 5000)`, [OWNER_STAFF.id, T, MANAGER_STAFF.id, T]);
});
after(async () => {
  if (!ENABLED) return;
  await pool.query("DELETE FROM attendance_logs WHERE tenant_id=? AND staff_id IN (?, ?)", [T, OWNER_STAFF.id, MANAGER_STAFF.id]);
  await pool.query("DELETE FROM staff WHERE tenant_id=? AND id IN (?, ?)", [T, OWNER_STAFF.id, MANAGER_STAFF.id]);
  await pool.end();
});

test('the helper: one\'s own record is refused, the owner\'s own record is not, nobody else\'s record is ever "self"', { skip }, () => {
  assert.equal(isSelfMutation(asManager(MANAGER_STAFF), MANAGER_STAFF.id), true);
  assert.equal(isSelfMutation(asManager(MANAGER_STAFF), OWNER_STAFF.id), false);
  assert.equal(isSelfMutation(asOwner(OWNER_STAFF), OWNER_STAFF.id), false, 'the owner is exempt');
  assert.equal(isSelfMutation(asManager(MANAGER_STAFF), undefined), false);
  assert.equal(isSelfMutation({ user: {}, isSuperAdmin: true }, 'x'), false, 'no staff record: nothing to compare');
});

test('the attendance entry: a manager cannot type their own day, the owner can', { skip }, async () => {
  const body = { staff_id: OWNER_STAFF.id, date: '2027-03-02', status: 'PRESENT' };
  const owner = await run(attendance, 'post', '/api/admin/hr/attendance', asOwner(OWNER_STAFF, { body, params: {}, query: {} }));
  assert.equal(owner.statusCode, 200, JSON.stringify(owner.body));
  const own = await run(attendance, 'post', '/api/admin/hr/attendance', asManager(MANAGER_STAFF, { body: { ...body, staff_id: MANAGER_STAFF.id }, params: {}, query: {} }));
  assert.equal(own.statusCode, 409);
  assert.equal(own.body.code, 'HR_SELF_MUTATION');
  const others = await run(attendance, 'post', '/api/admin/hr/attendance', asManager(MANAGER_STAFF, { body, params: {}, query: {} }));
  assert.equal(others.statusCode, 200, 'a manager can still type someone else\'s day');
});
