'use strict';
/**
 * The refund desk against a real MariaDB (strict mode, the production schema):
 * the decision and «تأكيد رد المبلغ». Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-refund-it';
let pool; let router;

const handlerOf = (method, route) => {
  const layer = router.stack.find(item => item.route && item.route.path === route && item.route.methods[method]);
  assert.ok(layer, `${method} ${route} is registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
};
async function call(method, route, { id, body = {}, staff }) {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  const req = {
    params: { id }, body, query: {}, headers: {}, tenantId: TENANT, user: { uid: 'u', email: 'x@example.com' },
    staffRecord: staff, isSuperAdmin: !staff, ip: '127.0.0.1', get: () => undefined,
  };
  await handlerOf(method, route)(req, res);
  return res;
}
const DOKKI_ACCOUNTANT = { id: 'st-dokki', name: 'محاسب الدقي', role: 'accountant', data_scope: 'branch:DAQQI' };

// Rows a run left behind (an interrupted run, a failed delete) must not
// break the next one: cleared before as well as after.
async function clean() {
  await pool.query('DELETE FROM refund_requests WHERE tenant_id=?', [TENANT]);
  await pool.query('DELETE FROM financial_audit_log WHERE tenant_id=?', [TENANT]).catch(() => {});
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  router = require('../../routes/finance');
  await pool.query(
    `INSERT INTO refund_requests (id, tenant_id, subscriber_id, amount, currency, status, branch_id)
     VALUES ('rr-online', ?, 'sub-1', 500, 'EGP', 'APPROVED', 'branch-online-egypt'),
            ('rr-dokki', ?, 'sub-2', 300, 'EGP', 'APPROVED', 'branch-daqqi'),
            ('rr-pending', ?, 'sub-3', 200, 'EGP', 'PENDING', 'branch-daqqi')`,
    [TENANT, TENANT, TENANT]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

const MARK = '/api/admin/finance/refunds/:id/mark-refunded';

test('«تأكيد رد المبلغ» is saved, once', { skip }, async () => {
  const first = await call('post', MARK, { id: 'rr-online' });
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  const [[row]] = await pool.query("SELECT status, refunded_at FROM refund_requests WHERE id='rr-online'");
  assert.equal(row.status, 'REFUNDED');
  assert.ok(row.refunded_at);
  const again = await call('post', MARK, { id: 'rr-online' });
  assert.equal(again.statusCode, 409);
});

test('a branch accountant confirms their branch\'s refunds only', { skip }, async () => {
  const other = await call('post', MARK, { id: 'rr-pending', staff: DOKKI_ACCOUNTANT });
  assert.equal(other.statusCode, 409, 'not approved yet');
  await pool.query("UPDATE refund_requests SET status='APPROVED' WHERE id='rr-online'");
  const foreign = await call('post', MARK, { id: 'rr-online', staff: DOKKI_ACCOUNTANT });
  assert.equal(foreign.statusCode, 404, 'another branch\'s refund is not there for them');
  const own = await call('post', MARK, { id: 'rr-dokki', staff: DOKKI_ACCOUNTANT });
  assert.equal(own.statusCode, 200, JSON.stringify(own.body));
});

test('«قيد المعالجة» is audited as handled, not refused', { skip }, async () => {
  const res = await call('put', '/api/admin/finance/refunds/:id', { id: 'rr-pending', body: { status: 'HANDLING', decision_note: 'اتنقل لكورس تاني' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const [[audit]] = await pool.query(
    "SELECT action FROM financial_audit_log WHERE tenant_id=? AND entity_id='rr-pending' ORDER BY created_at DESC LIMIT 1", [TENANT]);
  assert.equal(audit.action, 'handling');
});
