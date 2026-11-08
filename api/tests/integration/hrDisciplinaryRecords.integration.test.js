'use strict';
/**
 * Disciplinary records as they behave, on a real MariaDB (these were regular expressions over routes/hr/records.js): HR issues a record to an employee of
 * this institute; only the employee acknowledges it (HR's own acknowledge route refuses); once acknowledged, appealed or progressed its content is
 * immutable; the employee can appeal with a note; and no one deletes a record. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-discipline-it';
let pool; let router;

const HR = { id: 'st-dc-hr', name: 'الموارد', role: 'hr', permissions_json: '["manage_hr","view_hr"]' };
const EMP = { id: 'st-dc-emp', name: 'الموظفة', role: 'sales', permissions_json: '[]', email: 'emp-dc@example.test' };

async function call(method, path, { params = {}, body = {}, who = 'hr' } = {}) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method} ${path}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const employee = who === 'employee';
  const req = {
    params, body, query: {}, headers: {}, tenantId: T, ip: '127.0.0.1', get: () => undefined,
    user: { uid: employee ? 'u-emp' : 'u-hr', email: employee ? EMP.email : 'hr-dc@example.test' },
    staffRecord: employee ? EMP : HR, isSuperAdmin: !employee,
  };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

async function clean() {
  for (const table of ['disciplinary_records', 'audit_events', 'staff']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
}
const issue = async (title = 'تأخير') => {
  const res = await call('post', '/api/admin/hr/disciplinary', { body: { staff_id: EMP.id, type: 'warning', severity: 'low', title, description: 'متكرر' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body.id;
};
const statusOf = async id => (await pool.query('SELECT status, appeal_note, title FROM disciplinary_records WHERE id=?', [id]))[0][0];

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/hr/records');
  await clean();
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES
       (?, ?, 'الموارد', 'hr-dc@example.test', '1012340401', 'HR', 1, '2024-01-01'),
       (?, ?, 'الموظفة', ?, '1012340402', 'SALES', 1, '2024-01-01')`, [HR.id, T, EMP.id, T, EMP.email]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('a record is issued to an employee of this institute only, with a title and a known type', { skip }, async () => {
  assert.equal((await call('post', '/api/admin/hr/disciplinary', { body: { staff_id: EMP.id, title: '' } })).statusCode, 400);
  assert.equal((await call('post', '/api/admin/hr/disciplinary', { body: { staff_id: EMP.id, title: 'x', type: 'nonsense' } })).statusCode, 400);
  assert.equal((await call('post', '/api/admin/hr/disciplinary', { body: { staff_id: 'st-nobody', title: 'x' } })).statusCode, 404);
  const id = await issue();
  assert.equal((await statusOf(id)).status, 'open');
});

test('only the employee acknowledges; after that the record\'s content is immutable', { skip }, async () => {
  const id = await issue('غياب');
  const byHr = await call('put', '/api/admin/hr/disciplinary/:recId/acknowledge', { params: { recId: id } });
  assert.equal(byHr.statusCode, 409);
  assert.equal(byHr.body.code, 'EMPLOYEE_ACK_REQUIRED');
  assert.equal((await statusOf(id)).status, 'open', 'HR\'s attempt changed nothing');
  assert.equal((await call('put', '/api/admin/hr/disciplinary/:recId', { params: { recId: id }, body: { title: 'غياب متكرر' } })).statusCode, 200, 'an open record can still be corrected');
  const own = await call('put', '/api/staff/me/disciplinary/:recId/acknowledge', { params: { recId: id }, who: 'employee' });
  assert.equal(own.statusCode, 200, JSON.stringify(own.body));
  assert.equal((await statusOf(id)).status, 'acknowledged');
  const edit = await call('put', '/api/admin/hr/disciplinary/:recId', { params: { recId: id }, body: { title: 'تعديل بعد الإقرار' } });
  assert.equal(edit.statusCode, 409);
  assert.equal(edit.body.code, 'DISCIPLINARY_IMMUTABLE');
  assert.equal((await statusOf(id)).title, 'غياب متكرر');
  assert.equal((await call('put', '/api/staff/me/disciplinary/:recId/acknowledge', { params: { recId: id }, who: 'employee' })).statusCode, 409, 'and it is acknowledged once');
});

test('the employee can appeal with a note, and nobody deletes a record', { skip }, async () => {
  const id = await issue('إنذار');
  assert.equal((await call('put', '/api/staff/me/disciplinary/:recId/appeal', { params: { recId: id }, body: {}, who: 'employee' })).statusCode, 400, 'an appeal says why');
  const appeal = await call('put', '/api/staff/me/disciplinary/:recId/appeal', { params: { recId: id }, body: { appeal_note: 'كنت في إذن' }, who: 'employee' });
  assert.equal(appeal.statusCode, 200, JSON.stringify(appeal.body));
  assert.deepEqual({ ...(await statusOf(id)) }, { status: 'appealed', appeal_note: 'كنت في إذن', title: 'إنذار' });
  const remove = await call('delete', '/api/admin/hr/disciplinary/:recId', { params: { recId: id } });
  assert.equal(remove.statusCode, 409);
  assert.equal(remove.body.code, 'DISCIPLINARY_IMMUTABLE');
  assert.ok(await statusOf(id), 'the row is still there');
});
