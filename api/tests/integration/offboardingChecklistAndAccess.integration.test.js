'use strict';
/**
 * Offboarding as a whole, on a real MariaDB (these were regular expressions over routes/hr/offboarding.js and middleware/auth.js): it is started once per employee and never
 * by the employee for themself; it is closed only when the whole checklist is done, never by the employee themself, and only with a successor of the same role for any open
 * work — and a refused closing changes nothing; closing it switches off the staff row (with its termination date), the sign-in account (sessions ended), the therapist
 * profile, writes both audit events, and the very next request with the old token is refused; a closed offboarding is not edited again. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-offboard-access-it';
let pool; let router; let auth; let signAccessToken;

const HR = { id: 'st-oa-hr', name: 'الموارد', role: 'hr', permissions_json: '["manage_hr","view_hr"]' };

async function call(method, path, { params = {}, body = {}, staff = HR } = {}) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method} ${path}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params, body, query: {}, headers: {}, tenantId: T, user: { uid: 'u-hr', email: 'hr-oa@example.test', tenant_id: T }, staffRecord: staff, isSuperAdmin: false, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

async function clean() {
  for (const table of ['staff_offboarding', 'tasks', 'leads', 'therapists', 'users', 'audit_logs', 'staff']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}
const start = (staffId, extra = {}) => call('post', '/api/admin/hr/offboarding', { body: { staff_id: staffId, reason: 'resignation', ...extra } });
const finish = (id, body = {}, staff = HR) => call('put', '/api/admin/hr/offboarding/:id', { params: { id }, body: { status: 'completed', ...body }, staff });
const staffRow = async id => (await pool.query('SELECT is_active, termination_date FROM staff WHERE id=?', [id]))[0][0];
const events = async action => (await pool.query('SELECT id FROM audit_logs WHERE tenant_id=? AND action=?', [T, action]))[0].length;

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/hr/offboarding');
  auth = require('../../middleware/auth');
  ({ signAccessToken } = require('../../lib/token'));
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES
       ('st-oa-hr', ?, 'الموارد', 'hr-oa@example.test', '1019300001', 'HR', 1, '2024-01-01'),
       ('st-oa-sales', ?, 'منى المبيعات', 'sales-oa@example.test', '1019300002', 'SALES', 1, '2024-01-01'),
       ('st-oa-sales2', ?, 'سارة البديلة', 'sales2-oa@example.test', '1019300003', 'SALES', 1, '2024-01-01'),
       ('st-oa-cs', ?, 'علا خدمة العملاء', 'cs-oa@example.test', '1019300004', 'SUPPORT', 1, '2024-01-01')`, [T, T, T, T]);
  await pool.query("INSERT INTO users (id, tenant_id, email, phone, password_hash, name, role, is_active, session_version, active_session_id) VALUES ('us-oa-sales', ?, 'sales-oa@example.test', NULL, 'x', 'منى', 'user', 1, 1, 'sid-1')", [T]);
  await pool.query(
    `INSERT INTO leads (id, tenant_id, name, phone, source, status, assigned_sales_id, assigned_sales_name)
     VALUES ('ld-oa-1', ?, 'عميل مفتوح', '1019300101', 'test', 'new', 'st-oa-sales', 'منى المبيعات')`, [T]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('it is started once per employee, never by the employee for themself, and the start is audited', { skip }, async () => {
  assert.equal((await call('post', '/api/admin/hr/offboarding', { body: {} })).statusCode, 400, 'whom?');
  assert.equal((await start(HR.id)).statusCode, 409, 'not for oneself');
  assert.equal((await start('st-nobody')).statusCode, 404);
  const first = await start('st-oa-sales', { reason: 'nonsense' });
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.equal((await pool.query('SELECT reason FROM staff_offboarding WHERE id=?', [first.body.id]))[0][0].reason, 'resignation', 'an unknown reason is the default one');
  assert.equal((await start('st-oa-sales')).statusCode, 409, 'one in progress at a time');
  assert.equal(await events('hr.offboarding.started'), 1);
});

test('a closing is refused while the checklist is open, by the employee themself, or with a wrong successor — and nothing changes', { skip }, async () => {
  const [[off]] = await pool.query("SELECT id FROM staff_offboarding WHERE staff_id='st-oa-sales'");
  const open = await finish(off.id);
  assert.equal(open.statusCode, 409, 'the default checklist is not done');
  assert.equal((await finish(off.id, { checklist: [] })).statusCode, 409, 'an empty checklist is not a finished one');
  const done = [{ task: 'تسليم الأجهزة', done: true }];
  const self = await finish(off.id, { checklist: done, reassign_to: 'st-oa-sales2' }, { id: 'st-oa-sales', name: 'منى', role: 'hr', permissions_json: '["manage_hr"]' });
  assert.equal(self.statusCode, 409, 'nobody signs their own leaving');
  assert.equal((await finish(off.id, { checklist: done })).body.code, 'SUCCESSOR_REQUIRED');
  const wrongRole = await finish(off.id, { checklist: done, reassign_to: 'st-oa-cs' });
  assert.equal(wrongRole.statusCode, 409);
  assert.equal(wrongRole.body.code, 'SUCCESSOR_ROLE_MISMATCH');
  assert.equal((await finish(off.id, { checklist: done, reassign_to: 'st-oa-nobody' })).statusCode, 400, 'a successor who does not exist');
  assert.equal(Number((await staffRow('st-oa-sales')).is_active), 1);
  assert.equal((await pool.query("SELECT assigned_sales_id FROM leads WHERE id='ld-oa-1'"))[0][0].assigned_sales_id, 'st-oa-sales', 'the work did not move');
  assert.equal((await pool.query('SELECT status FROM staff_offboarding WHERE id=?', [off.id]))[0][0].status, 'in_progress');
  assert.equal(await events('hr.offboarding.completed'), 0);
});

test('closing switches off the staff row, the sign-in and the therapist profile, moves the work, audits it, and the old token is refused at once', { skip }, async () => {
  await pool.query("INSERT INTO therapists (id, tenant_id, staff_id, name, specialty, image, price_egp, is_active, is_consultation_enabled, featured) VALUES ('th-oa-1', ?, 'st-oa-sales', 'منى', '', '', 400, 1, 1, 1)", [T]);
  const token = signAccessToken({ uid: 'us-oa-sales', email: 'sales-oa@example.test', tenantId: T, sessionVersion: 1, sessionId: 'sid-1', isStaff: true });
  const authenticate = async () => {
    const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
    let passed = false;
    await auth.requireAuth({ headers: { authorization: `Bearer ${token}` }, tenantId: T, query: {}, ip: '127.0.0.1', get: () => undefined }, res, () => { passed = true; });
    return { passed, res };
  };
  assert.equal((await authenticate()).passed, true, 'while employed the token works');

  const [[off]] = await pool.query("SELECT id FROM staff_offboarding WHERE staff_id='st-oa-sales'");
  const closed = await finish(off.id, { checklist: [{ task: 'تسليم الأجهزة', done: true }], reassign_to: 'st-oa-sales2' });
  assert.equal(closed.statusCode, 200, JSON.stringify(closed.body));
  const staff = await staffRow('st-oa-sales');
  assert.deepEqual([Number(staff.is_active), !!staff.termination_date], [0, true], 'switched off, with the day they left');
  const [[user]] = await pool.query("SELECT is_active, session_version, active_session_id FROM users WHERE id='us-oa-sales'");
  assert.deepEqual([Number(user.is_active), Number(user.session_version), user.active_session_id], [0, 2, null], 'the sign-in is off and its sessions ended');
  const [[therapist]] = await pool.query("SELECT is_active, is_consultation_enabled, featured FROM therapists WHERE id='th-oa-1'");
  assert.deepEqual([Number(therapist.is_active), Number(therapist.is_consultation_enabled), Number(therapist.featured)], [0, 0, 0], 'off the site and the consultations');
  assert.equal((await pool.query("SELECT assigned_sales_id FROM leads WHERE id='ld-oa-1'"))[0][0].assigned_sales_id, 'st-oa-sales2');
  assert.equal(await events('hr.offboarding.completed'), 1);

  const after = await authenticate();
  assert.equal(after.passed, false, 'the very next request with the old token');
  assert.equal(after.res.statusCode, 401);
  assert.equal(after.res.body.code, 'ACCOUNT_UNAVAILABLE');

  assert.equal((await finish(off.id, { checklist: [{ task: 'x', done: true }] })).statusCode, 409, 'a closed offboarding is not edited again');
});
