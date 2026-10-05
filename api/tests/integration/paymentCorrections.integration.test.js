'use strict';
/**
 * Deleting and correcting a payment entered by mistake (lib/paymentCorrections.js):
 * managers only, the books reversed, the commission and the course access
 * following it — and a correction is one payment, not two. Real MariaDB.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-paycorr-it';
let pool; let payments; let corrections;

const SALES = { id: 'st-pc-rep', name: 'مندوب', role: 'sales', permissions: '["manage_payments"]' };
const MANAGER = { id: 'st-pc-mgr', name: 'المدير', role: 'manager', permissions: '["manage_payments","manage_financial"]' };

async function call(router, method, route, { params = {}, body = {}, staff = null } = {}) {
  const layer = router.stack.find(item => item.route?.path === route && item.route.methods[method]);
  assert.ok(layer, `${method} ${route}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = {
    params, body, query: {}, headers: {}, tenantId: TENANT, user: { uid: 'u', email: 'boss@example.test' },
    staffRecord: staff, isSuperAdmin: !staff, ip: '127.0.0.1', get: () => undefined,
  };
  const handlers = layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name));
  for (const handle of handlers) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

async function clean() {
  await pool.query('DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)', [TENANT]).catch(() => {});
  for (const table of ['journal_entries', 'payment_audit_log', 'financial_audit_log', 'crm_commissions', 'instructor_fees', 'financial_documents',
    'entitlement_events', 'enrollments', 'payments', 'subscribers', 'courses', 'staff', 'tenant_settings', 'outbox']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
}

const record = async (overrides = {}) => {
  const res = await call(payments, 'post', '/api/admin/subscriber-payments', {
    body: { subscriber_id: 'sub-pc-1', payment: { amount: 1000, currency: 'EGP', paymentType: 'course', courseId: 'co-pc-1', paymentMethod: 'كاش', status: 'paid', transactionId: 'TX-PC-1', ...overrides } },
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body.id;
};
const journalNet = async () => {
  const [[row]] = await pool.query(
    `SELECT COALESCE(SUM(jel.debit - jel.credit),0) AS cash FROM journal_entries je JOIN journal_entry_lines jel ON jel.entry_id=je.id
      WHERE je.tenant_id=? AND jel.account_code='1100'`, [TENANT]);
  return Number(row.cash);
};

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [TENANT, TENANT]);
  await require('../../lib/tenantSettings').setTenantSetting('content', {
    'exchange.sar_to_egp': '13', 'exchange.usd_to_egp': '48', 'exchange.source': 'test', 'exchange.updated_at': new Date().toISOString(),
  }, { tenantId: TENANT });
  require('../../lib/finance').invalidateFxCache(TENANT);
  payments = require('../../routes/subscriber-payments');
  corrections = require('../../routes/payment-corrections');
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, commission_rate) VALUES
       ('st-pc-rep', ?, 'مندوب', 'rep-pc@example.test', '1019000001', 'SALES', 1, '2025-01-01', 10),
       ('st-pc-mgr', ?, 'المدير', 'mgr-pc@example.test', '1019000002', 'MANAGER', 1, '2025-01-01', 0)`, [TENANT, TENANT]);
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp)
     VALUES ('co-pc-1', ?, 'كورس', '', '', '', '', 'GENERAL', 'RECORDED', 1000), ('co-pc-2', ?, 'كورس تاني', '', '', '', '', 'GENERAL', 'RECORDED', 2000)`, [TENANT, TENANT]);
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, name, phone, branch, branch_id, assigned_sales_id)
     VALUES ('sub-pc-1', ?, 'عميل', '1019000003', 'ONLINE_EGYPT', 'branch-online-egypt', 'st-pc-rep')`, [TENANT]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('only a manager may delete or change a payment', { skip }, async () => {
  const id = await record();
  const byRep = await call(corrections, 'delete', '/api/admin/payments/:id', { params: { id }, body: { reason: 'غلط' }, staff: SALES });
  assert.equal(byRep.statusCode, 403);
  const noReason = await call(corrections, 'delete', '/api/admin/payments/:id', { params: { id }, body: {}, staff: MANAGER });
  assert.equal(noReason.statusCode, 400);
});

test('deleting reverses the books, cancels the commission and closes the course', { skip }, async () => {
  const [[pay]] = await pool.query("SELECT id FROM payments WHERE tenant_id=? AND deleted_at IS NULL", [TENANT]);
  assert.equal(await journalNet(), 1000);
  const res = await call(corrections, 'delete', '/api/admin/payments/:id', { params: { id: pay.id }, body: { reason: 'اتسجلت بالغلط' }, staff: MANAGER });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(await journalNet(), 0, 'the cash the payment put in the books is taken out');
  const [[row]] = await pool.query('SELECT deleted_at, note FROM payments WHERE id=?', [pay.id]);
  assert.ok(row.deleted_at);
  assert.match(row.note, /اتسجلت بالغلط/);
  const [commissions] = await pool.query('SELECT status FROM crm_commissions WHERE tenant_id=? AND payment_id=?', [TENANT, pay.id]);
  assert.ok(commissions.every(c => c.status === 'CANCELLED'));
  const [[enrolment]] = await pool.query("SELECT status FROM enrollments WHERE tenant_id=? AND subscriber_id='sub-pc-1' AND course_id='co-pc-1'", [TENANT]);
  assert.notEqual(enrolment?.status, 'active');
  const again = await call(corrections, 'delete', '/api/admin/payments/:id', { params: { id: pay.id }, body: { reason: 'تاني' }, staff: MANAGER });
  assert.equal(again.statusCode, 404);
});

test('changing the method or date edits the same payment', { skip }, async () => {
  const id = await record({ transactionId: 'TX-PC-2' });
  const res = await call(corrections, 'patch', '/api/admin/payments/:id', { params: { id }, body: { reason: 'الخزنة غلط', paymentMethod: 'انستا باي' }, staff: MANAGER });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.mode, 'edited');
  const [rows] = await pool.query("SELECT id, payment_method FROM payments WHERE tenant_id=? AND deleted_at IS NULL", [TENANT]);
  assert.deepEqual(rows.map(r => [r.id, r.payment_method]), [[id, 'انستا باي']]);
});

test('a new amount is one corrected payment, not a second one — and keeps its transaction number', { skip }, async () => {
  const [[old]] = await pool.query("SELECT id FROM payments WHERE tenant_id=? AND deleted_at IS NULL", [TENANT]);
  const res = await call(corrections, 'patch', '/api/admin/payments/:id', { params: { id: old.id }, body: { reason: 'المبلغ غلط', amount: 800 }, staff: MANAGER });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.mode, 'replaced');
  const [rows] = await pool.query("SELECT id, amount, transaction_id, staff_id FROM payments WHERE tenant_id=? AND deleted_at IS NULL", [TENANT]);
  assert.equal(rows.length, 1);
  assert.deepEqual([Number(rows[0].amount), rows[0].transaction_id], [800, 'TX-PC-2']);
  assert.equal(await journalNet(), 800);
});

test('a new currency needs the amount again, and books at that currency', { skip }, async () => {
  const [[old]] = await pool.query("SELECT id FROM payments WHERE tenant_id=? AND deleted_at IS NULL", [TENANT]);
  const missing = await call(corrections, 'patch', '/api/admin/payments/:id', { params: { id: old.id }, body: { reason: 'العملة غلط', currency: 'SAR' }, staff: MANAGER });
  assert.equal(missing.body.code, 'AMOUNT_REQUIRED');
  const res = await call(corrections, 'patch', '/api/admin/payments/:id', { params: { id: old.id }, body: { reason: 'العملة غلط', currency: 'SAR', amount: 100, courseExpected: 150 }, staff: MANAGER });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const [rows] = await pool.query("SELECT amount, currency, amount_egp FROM payments WHERE tenant_id=? AND deleted_at IS NULL", [TENANT]);
  assert.deepEqual(rows.map(r => [Number(r.amount), r.currency, Number(r.amount_egp)]), [[100, 'SAR', 1300]]);
  assert.equal(await journalNet(), 1300);
});

test('moving a payment to another course moves the access with it', { skip }, async () => {
  const [[old]] = await pool.query("SELECT id FROM payments WHERE tenant_id=? AND deleted_at IS NULL", [TENANT]);
  const res = await call(corrections, 'patch', '/api/admin/payments/:id', { params: { id: old.id }, body: { reason: 'الكورس غلط', courseId: 'co-pc-2' }, staff: MANAGER });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const [[row]] = await pool.query("SELECT course_id FROM payments WHERE tenant_id=? AND deleted_at IS NULL", [TENANT]);
  assert.equal(row.course_id, 'co-pc-2');
  const [enrolments] = await pool.query("SELECT course_id, status FROM enrollments WHERE tenant_id=? AND subscriber_id='sub-pc-1' ORDER BY course_id", [TENANT]);
  const active = enrolments.filter(e => e.status === 'active').map(e => e.course_id);
  assert.deepEqual(active, ['co-pc-2']);
});
