'use strict';
/**
 * Recording a payment by hand and approving it, as it behaves on a real MariaDB (these were regular expressions over routes/subscriber-payments.js
 * and routes/core/financepay.js): whoever may not approve money records it as «pending» and it reaches neither the books nor the course until a
 * finance account approves it; approval posts the journal and opens the course exactly once; a payment can be rejected only with a reason, and a
 * refunded one is not touched by this route; a refund request is decided once, by someone who may approve refunds. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-manualpay-it';
let pool; let payments; let approval; let refunds;

const SALES = { id: 'st-mp-rep', name: 'مندوب', role: 'sales', permissions_json: '["manage_payments"]' };
const MANAGER = { id: 'st-mp-mgr', name: 'المدير', role: 'manager', permissions_json: '["manage_payments","manage_financial"]' };

async function call(router, method, route, { params = {}, body = {}, staff }) {
  const layer = router.stack.find(item => item.route?.path === route && item.route.methods[method]);
  assert.ok(layer, `${method} ${route}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params, body, query: {}, headers: {}, tenantId: T, user: { uid: 'u', email: 'boss@example.test' }, staffRecord: staff, isSuperAdmin: false, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

async function clean() {
  await pool.query('DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)', [T]).catch(() => {});
  for (const table of ['journal_entries', 'payment_audit_log', 'financial_audit_log', 'crm_commissions', 'instructor_fees', 'entitlement_events', 'enrollments',
    'outbox', 'orders', 'refund_requests', 'payments', 'subscribers', 'courses', 'staff', 'tenant_settings']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}

const record = async (staff, overrides = {}) => call(payments, 'post', '/api/admin/subscriber-payments', {
  staff, body: { subscriber_id: 'sub-mp-1', payment: { amount: 1000, currency: 'EGP', paymentType: 'course', courseId: 'co-mp-1', paymentMethod: 'كاش', status: 'paid', transactionId: `TX-MP-${Math.random()}`, ...overrides } },
});
const cash = async () => Number((await pool.query(
  `SELECT COALESCE(SUM(jel.debit - jel.credit),0) AS cash FROM journal_entries je JOIN journal_entry_lines jel ON jel.entry_id=je.id
    WHERE je.tenant_id=? AND jel.account_code='1100'`, [T]))[0][0].cash);
const enrolled = async () => (await pool.query("SELECT id FROM enrollments WHERE tenant_id=? AND subscriber_id='sub-mp-1' AND course_id='co-mp-1'", [T]))[0].length;

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  payments = require('../../routes/subscriber-payments');
  approval = require('../../routes/core/financepay');
  refunds = require('../../routes/finance/refunds');
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, commission_rate) VALUES
       ('st-mp-rep', ?, 'مندوب', 'rep-mp@example.test', '1019100001', 'SALES', 1, '2025-01-01', 10),
       ('st-mp-mgr', ?, 'المدير', 'mgr-mp@example.test', '1019100002', 'MANAGER', 1, '2025-01-01', 0)`, [T, T]);
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp, booking_bonuses_json)
     VALUES ('co-mp-1', ?, 'كورس', '', '', '', '', 'GENERAL', 'RECORDED', 1000, '{"sales":{"type":"fixed","value":50},"service":{"type":"fixed","value":30}}')`, [T]);
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, name, phone, branch, branch_id, assigned_sales_id)
     VALUES ('sub-mp-1', ?, 'عميل', '1019100003', 'ONLINE_EGYPT', 'branch-online-egypt', 'st-mp-rep')`, [T]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('a rep\'s «paid» is recorded as pending and moves nothing until a finance account approves it', { skip }, async () => {
  const made = await record(SALES);
  assert.equal(made.statusCode, 200, JSON.stringify(made.body));
  const [[row]] = await pool.query('SELECT status FROM payments WHERE id=?', [made.body.id]);
  assert.equal(row.status, 'pending', 'the rep cannot approve their own money');
  assert.equal(await cash(), 0, 'nothing in the books');
  assert.equal(await enrolled(), 0, 'and the course is not open');

  const approve = await call(approval, 'patch', '/api/admin/payments/:id/status', { params: { id: made.body.id }, body: { status: 'paid' }, staff: MANAGER });
  assert.equal(approve.statusCode, 200, JSON.stringify(approve.body));
  const [[paid]] = await pool.query('SELECT status FROM payments WHERE id=?', [made.body.id]);
  assert.equal(paid.status, 'paid');
  assert.equal(await cash(), 1000, 'the journal is posted on approval');
  assert.equal(await enrolled(), 1, 'and the course opens');
  const [commissions] = await pool.query('SELECT commission_amount, status FROM crm_commissions WHERE tenant_id=?', [T]);
  assert.deepEqual(commissions.map(row => [Number(row.commission_amount), row.status]), [[100, 'PENDING']], 'approving pays the rep 10% of it and nothing more: booking bonuses are set, and no bonus is written by the system (HR types them)');

  const again = await call(approval, 'patch', '/api/admin/payments/:id/status', { params: { id: made.body.id }, body: { status: 'paid' }, staff: MANAGER });
  assert.equal(again.statusCode, 200);
  assert.equal(await cash(), 1000, 'approving twice posts once');
  assert.equal(await enrolled(), 1);
});

test('a finance account\'s «paid» is paid at once, and a payment is rejected only with a reason', { skip }, async () => {
  const made = await record(MANAGER, { amount: 400, courseId: null, paymentType: 'other' });
  assert.equal(made.statusCode, 200, JSON.stringify(made.body));
  const [[row]] = await pool.query('SELECT status FROM payments WHERE id=?', [made.body.id]);
  assert.equal(row.status, 'paid');

  const pending = await record(SALES, { amount: 300, courseId: null, paymentType: 'other' });
  const bare = await call(approval, 'patch', '/api/admin/payments/:id/status', { params: { id: pending.body.id }, body: { status: 'failed' }, staff: MANAGER });
  assert.equal(bare.statusCode, 400, 'a rejection says why');
  const reasoned = await call(approval, 'patch', '/api/admin/payments/:id/status', { params: { id: pending.body.id }, body: { status: 'failed', reviewNote: 'الإيصال غير واضح' }, staff: MANAGER });
  assert.equal(reasoned.statusCode, 200, JSON.stringify(reasoned.body));
  const [[failed]] = await pool.query('SELECT status FROM payments WHERE id=?', [pending.body.id]);
  assert.equal(failed.status, 'failed');
});

test('«refunded» is not a status this route sets', { skip }, async () => {
  const made = await record(MANAGER, { amount: 100, courseId: null, paymentType: 'other' });
  const res = await call(approval, 'patch', '/api/admin/payments/:id/status', { params: { id: made.body.id }, body: { status: 'refunded' }, staff: MANAGER });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'PAYMENT_STATUS_INVALID');
});

test('a refund request is decided once', { skip }, async () => {
  await pool.query("INSERT INTO refund_requests (id, tenant_id, subscriber_id, amount, status) VALUES ('rf-mp-1', ?, 'sub-mp-1', 100, 'PENDING')", [T]);
  const asked = staff => call(refunds, 'put', '/api/admin/finance/refunds/:id', { params: { id: 'rf-mp-1' }, body: { status: 'REJECTED', decision_note: 'خارج المدة' }, staff });
  assert.equal((await asked(SALES)).statusCode, 403, 'not for someone without the refund permission');
  const first = await asked({ ...MANAGER, permissions_json: '["approve_refunds"]' });
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  const second = await asked({ ...MANAGER, permissions_json: '["approve_refunds"]' });
  assert.equal(second.statusCode, 409);
  assert.match(second.body.error, /already been resolved/);
});
