'use strict';
/**
 * Who may see and set whose pay (11 Nov 2026), on a real MariaDB: a branch manager's month sheet holds only the branch's staff and no salary or bonus figure, and nobody
 * sets their own attendance, salary, target or bonuses. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-branch-pay-it';
let pool; let payroll; let attendance; let staffFile; let bonuses;

const MANAGER = { id: 'st-bp-mgr', name: 'مدير الدقي', role: 'DAQQI_MANAGER', permissions_json: '[]' };
const ADMIN = { id: 'st-bp-admin', name: 'أدمن', role: 'admin', permissions_json: '[]' };

async function call(router, method, path, { staff, body = {}, query = {}, params = {} }) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method} ${path}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params, body, query, headers: {}, tenantId: T, user: { uid: staff.id, email: `${staff.id}@example.test` }, staffRecord: staff, isSuperAdmin: false, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

async function clean() {
  for (const table of ['attendance_logs', 'employee_bonuses', 'audit_events', 'hr_policy_versions', 'staff']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  payroll = require('../../routes/hr/payroll');
  attendance = require('../../routes/hr/attendance');
  staffFile = require('../../routes/hr/staff-file');
  bonuses = require('../../routes/hr/bonuses');
  await clean();
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, base_salary, branch_id) VALUES
       (?, ?, 'مدير الدقي', 'bp-mgr@example.test', '1012340801', 'DAQQI_MANAGER', 1, '2024-01-01', 9000, 'branch-daqqi'),
       ('st-bp-desk', ?, 'ريسبشن الدقي', 'bp-desk@example.test', '1012340802', 'RECEPTION_DAQQI', 1, '2024-01-01', 4000, 'branch-daqqi'),
       ('st-bp-other', ?, 'مبيعات تانية', 'bp-oth@example.test', '1012340803', 'SALES', 1, '2024-01-01', 5000, 'branch-online'),
       (?, ?, 'أدمن', 'bp-admin@example.test', '1012340804', 'ADMIN', 1, '2024-01-01', 20000, 'branch-all')`, [MANAGER.id, T, T, T, ADMIN.id, T]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('a branch manager\'s month sheet holds the branch\'s staff and attendance only: no salary, no bonus figure', { skip }, async () => {
  const branch = await call(payroll, 'get', '/api/admin/hr/attendance/summary', { staff: MANAGER, query: { month: '11', year: '2026' } });
  assert.equal(branch.statusCode, 200, JSON.stringify(branch.body));
  assert.deepEqual(branch.body.map(row => row.id).sort(), ['st-bp-desk', 'st-bp-mgr'], 'the Dokki staff and nobody else');
  for (const row of branch.body) {
    assert.equal(row.base_salary, null, 'no salary');
    assert.equal(row.bonuses, null, 'no bonus figures');
    assert.equal(row.bonus_plan, null);
  }
  const full = await call(payroll, 'get', '/api/admin/hr/attendance/summary', { staff: ADMIN, query: { month: '11', year: '2026' } });
  assert.equal(full.statusCode, 200, JSON.stringify(full.body));
  assert.equal(full.body.find(row => row.id === 'st-bp-desk').base_salary, 4000, 'whoever holds view_hr still sees it');
  assert.ok(full.body.some(row => row.id === 'st-bp-other'));
});

test('nobody marks their own attendance, sets their own salary or target, or changes their own bonuses', { skip }, async () => {
  const day = await call(attendance, 'post', '/api/admin/hr/attendance', { staff: ADMIN, body: { staff_id: ADMIN.id, date: '2026-11-02', status: 'PRESENT' } });
  assert.equal(day.statusCode, 409);
  assert.equal(day.body.code, 'HR_SELF_MUTATION');
  const [[written]] = await pool.query('SELECT COUNT(*) n FROM attendance_logs WHERE tenant_id=? AND staff_id=?', [T, ADMIN.id]);
  assert.equal(Number(written.n), 0);
  const others = await call(attendance, 'post', '/api/admin/hr/attendance', { staff: ADMIN, body: { staff_id: 'st-bp-desk', date: '2026-11-02', status: 'PRESENT' } });
  assert.equal(others.statusCode, 200, JSON.stringify(others.body));

  const pay = await call(staffFile, 'put', '/api/admin/hr/staff/:staffId/pay', { staff: ADMIN, params: { staffId: ADMIN.id }, body: { baseSalary: 99999, commissionType: 'NONE' } });
  assert.equal(pay.body.code, 'HR_SELF_MUTATION');
  const basics = await call(staffFile, 'put', '/api/admin/hr/staff-basics', { staff: ADMIN, body: { rows: [{ id: ADMIN.id, baseSalary: 99999 }] } });
  assert.equal(basics.body.code, 'HR_SELF_MUTATION');
  const [[salary]] = await pool.query('SELECT base_salary FROM staff WHERE tenant_id=? AND id=?', [T, ADMIN.id]);
  assert.equal(Number(salary.base_salary), 20000, 'the salary did not move');
  const bio = await call(staffFile, 'put', '/api/admin/hr/staff-basics', { staff: ADMIN, body: { rows: [{ id: ADMIN.id, biometricNo: '77' }] } });
  assert.equal(bio.statusCode, 200, 'a device number on one\'s own row is not pay');
  const otherSalary = await call(staffFile, 'put', '/api/admin/hr/staff-basics', { staff: ADMIN, body: { rows: [{ id: 'st-bp-desk', baseSalary: 4500 }] } });
  assert.equal(otherSalary.statusCode, 200, JSON.stringify(otherSalary.body));

  const adjust = await call(bonuses, 'post', '/api/admin/hr/bonus-adjustments', { staff: ADMIN, body: { month: '2026-11', kind: 'SET_ROUND', staffId: ADMIN.id, reason: 'x' } });
  assert.equal(adjust.body.code, 'HR_SELF_MUTATION');
});

test('11 Nov 2026: the employees list gives the commission rate only to whoever holds view_hr, not to a branch manager', { skip }, async () => {
  await pool.query("UPDATE staff SET commission_rate=7.5 WHERE tenant_id=? AND id IN ('st-bp-desk', 'st-bp-other')", [T]);
  const branch = await call(require('../../routes/hr/employees'), 'get', '/api/admin/hr/employees', { staff: MANAGER });
  assert.equal(branch.statusCode, 200, JSON.stringify(branch.body));
  assert.deepEqual(branch.body.map(row => row.id).sort(), ['st-bp-desk', 'st-bp-mgr']);
  for (const row of branch.body) assert.equal(row.commission_rate, null, 'a branch manager sees the people, not their pay');
  const full = await call(require('../../routes/hr/employees'), 'get', '/api/admin/hr/employees', { staff: ADMIN });
  assert.equal(Number(full.body.find(row => row.id === 'st-bp-desk').commission_rate), 7.5);
});
