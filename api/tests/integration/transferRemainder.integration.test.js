'use strict';
/**
 * «عميل كان دافع 1850 ربطه بدفعة 3000 جنيه، مبلغ 3000 جنيه كله اتربط — المفروض
 * يتبقي 1150 يظهرلي ان دا باقي ربط من 3000» (10 Oct 2026). Linking a transfer to a
 * smaller payment keeps the rest as a free transfer, marked with the one it came
 * from. Real MariaDB, through PATCH /api/admin/payments/:id/status.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-transferrest-it';
let pool; let router;

async function approve(paymentId, transferId) {
  const layer = router.stack.find(item => item.route?.path === '/api/admin/payments/:id/status' && item.route.methods.patch);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = {
    params: { id: paymentId }, body: { status: 'paid', paymentMethod: 'فودافون كاش', transfer: { transferId } }, query: {}, headers: {},
    tenantId: TENANT, user: { uid: 'u', email: 'boss@example.test' }, staffRecord: null, isSuperAdmin: true, ip: '1', get: () => undefined,
  };
  await layer.route.stack.at(-1).handle(req, res);
  return res;
}

const transfers = async () => (await pool.query(
  'SELECT id, amount, reference, payment_id, parent_transfer_id, original_amount, note FROM incoming_transfers WHERE tenant_id=? ORDER BY created_at, reference', [TENANT]))[0];

async function clean() {
  await pool.query('DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)', [TENANT]).catch(() => {});
  for (const table of ['journal_entries', 'payment_audit_log', 'financial_audit_log', 'crm_commissions', 'instructor_fees', 'financial_documents',
    'entitlement_events', 'enrollments', 'incoming_transfers', 'payments', 'subscribers', 'courses', 'outbox']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/core/financepay');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [TENANT, TENANT]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, branch) VALUES ('sub-tr-1', ?, 'عميل', '1017000001', 'ONLINE_EGYPT'), ('sub-tr-2', ?, 'عميل تاني', '1017000002', 'ONLINE_EGYPT')", [TENANT, TENANT]);
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, amount, currency, payment_type, payment_method, status, date) VALUES
       ('pay-tr-1', ?, 'sub-tr-1', 1850, 'EGP', 'OTHER', 'فودافون كاش', 'pending', CURDATE()),
       ('pay-tr-2', ?, 'sub-tr-2', 1000, 'EGP', 'OTHER', 'فودافون كاش', 'pending', CURDATE())`, [TENANT, TENANT]);
  await pool.query(
    `INSERT INTO incoming_transfers (id, tenant_id, amount, currency, method, reference, sender_name, received_on)
     VALUES ('tr-big', ?, 3000, 'EGP', 'فودافون كاش', '7781', 'المحوِّل', CURDATE())`, [TENANT]);
});
after(async () => { if (!ENABLED) return; await clean(); await pool.end(); });

test('3,000 linked to a 1,850 payment leaves 1,150 free, marked as the rest of 3,000', { skip }, async () => {
  const res = await approve('pay-tr-1', 'tr-big');
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const rows = await transfers();
  const linked = rows.find(row => row.id === 'tr-big');
  const rest = rows.find(row => row.id !== 'tr-big');
  assert.deepEqual([Number(linked.amount), linked.payment_id, Number(linked.original_amount)], [1850, 'pay-tr-1', 3000]);
  assert.deepEqual([Number(rest.amount), rest.payment_id, rest.parent_transfer_id, Number(rest.original_amount), rest.reference],
    [1150, null, 'tr-big', 3000, '7781/باقي 1']);
  assert.match(rest.note, /باقي ربط من تحويل 3,000/);
  assert.equal(rows.reduce((sum, row) => sum + Number(row.amount), 0), 3000, 'the ledger still holds the 3,000 that arrived');
});

test('the rest is linked in turn, and what is left of it still names the first transfer', { skip }, async () => {
  const rest = (await transfers()).find(row => row.id !== 'tr-big');
  const res = await approve('pay-tr-2', rest.id);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const rows = await transfers();
  const free = rows.filter(row => !row.payment_id);
  assert.equal(free.length, 1);
  assert.deepEqual([Number(free[0].amount), free[0].parent_transfer_id, Number(free[0].original_amount), free[0].reference], [150, 'tr-big', 3000, '7781/باقي 2']);
});

test('a voided payment gives its transfer back', { skip }, async () => {
  const { voidPayment } = require('../../lib/paymentCorrections');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await voidPayment(conn, { tenantId: TENANT, paymentId: 'pay-tr-2', actor: 'المدير', reason: 'اتسجلت غلط' });
    await conn.commit();
  } finally { conn.release(); }
  const freed = (await transfers()).find(row => row.reference === '7781/باقي 1');
  assert.equal(freed.payment_id, null);
});
