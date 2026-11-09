'use strict';
/**
 * The orders desk's status road, on a real MariaDB (these were regular expressions over routes/orders.js — `reasonOf`, `REASON_REQUIRED`, `kind: 'order'`; the payment
 * and proof roads are in paymentReviewAndReceipts / checkoutAndProofs): rejecting an order's payment needs a reason and the person who recorded it is told that reason in a
 * message (not the one who rejected); «paid» and «refunded» are not set here at all; an order that already has a payment, or is already paid, is not changed from this road;
 * an unknown order is not found; and an account without manage_orders is refused. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-order-reject-it';
let pool; let orders;

const ACCOUNTS = { id: 'st-or-acc', name: 'المحاسبة', role: 'accountant', permissions_json: '["manage_orders","manage_financial"]' };
const OUTSIDER = { id: 'st-or-out', name: 'آخر', role: 'sales', permissions_json: '["view_leads"]' };

async function patch(id, body, staff = ACCOUNTS) {
  const layer = orders.stack.find(item => item.route?.path === '/api/admin/orders/:id' && item.route.methods.patch);
  assert.ok(layer);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params: { id }, body, query: {}, headers: {}, tenantId: T, user: { uid: 'u', email: 'acc-or@example.test', tenant_id: T }, staffRecord: staff, isSuperAdmin: false, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}
const status = async id => String((await pool.query('SELECT status FROM orders WHERE id=?', [id]))[0][0].status).toLowerCase();

async function clean() {
  for (const table of ['staff_messages', 'notifications', 'payment_audit_log', 'payments', 'orders', 'subscribers', 'staff']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  orders = require('../../routes/orders');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES
       ('st-or-rep', ?, 'المندوبة', 'rep-or@example.test', '1019400001', 'SALES', 1, '2025-01-01'),
       ('st-or-acc', ?, 'المحاسبة', 'acc-or@example.test', '1019400002', 'ACCOUNTANT', 1, '2025-01-01'),
       ('st-or-out', ?, 'آخر', 'out-or@example.test', '1019400003', 'SALES', 1, '2025-01-01')`, [T, T, T]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, client_code, name, phone, branch, branch_id) VALUES ('sub-or-1', ?, 'OR1', 'هبة', '1019400010', 'ONLINE_EGYPT', 'branch-online-egypt')", [T]);
  const order = (id, orderStatus, txn = null) => pool.query(
    `INSERT INTO orders (id, tenant_id, type, item_id, item_title, amount, currency, payment_method, customer_name, status, transaction_id, subscriber_id, staff_id, branch_id)
     VALUES (?, ?, 'COURSE', 'x', 'كورس', 800, 'EGP', 'TRANSFER', 'هبة', ?, ?, 'sub-or-1', 'st-or-rep', 'branch-online-egypt')`, [id, T, orderStatus, txn]);
  await order('ord-or-1', 'PENDING');
  await order('ord-or-2', 'PAID');
  await order('ord-or-3', 'PENDING', 'TX-OR-3');
  await order('ord-or-4', 'PENDING');
  await pool.query("INSERT INTO payments (id, tenant_id, subscriber_id, amount, amount_egp, currency, payment_type, payment_method, status, transaction_id, date) VALUES ('pay-or-3', ?, 'sub-or-1', 800, 800, 'EGP', 'COURSE', 'TRANSFER', 'pending', 'TX-OR-3', NOW())", [T]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('rejecting an order\'s payment needs a reason, and whoever recorded it is told the reason in a message', { skip }, async () => {
  const bare = await patch('ord-or-1', { status: 'failed' });
  assert.equal(bare.statusCode, 400);
  assert.equal(bare.body.code, 'REJECT_REASON_REQUIRED');
  assert.equal(await status('ord-or-1'), 'pending', 'nothing changed without a reason');
  const done = await patch('ord-or-1', { status: 'failed', reason: 'الإيصال غير مطابق للطلب' });
  assert.equal(done.statusCode, 200, JSON.stringify(done.body));
  assert.equal(await status('ord-or-1'), 'failed');
  const [messages] = await pool.query("SELECT staff_id, body FROM staff_messages WHERE tenant_id=? AND body LIKE '%الإيصال غير مطابق للطلب%'", [T]);
  assert.ok(messages.some(message => message.staff_id === 'st-or-rep'), 'the one who recorded it');
  assert.ok(!messages.some(message => message.staff_id === 'st-or-acc'), 'not the one who rejected it');
});

test('«paid» and «refunded» are not set on this road, and an order with a payment or already paid is not changed from it', { skip }, async () => {
  for (const state of ['paid', 'refunded']) {
    assert.equal((await patch('ord-or-4', { status: state })).statusCode, 409, state);
  }
  assert.equal(await status('ord-or-4'), 'pending');
  assert.equal((await patch('ord-or-3', { status: 'failed', reason: 'ألغاها العميل تماماً' })).statusCode, 409, 'it has a payment: that road decides');
  assert.equal(await status('ord-or-3'), 'pending');
  assert.equal((await patch('ord-or-2', { status: 'failed', reason: 'سبب كافٍ للرفض' })).statusCode, 409, 'already paid');
  assert.equal(await status('ord-or-2'), 'paid');
  assert.equal((await patch('ord-or-nobody', { status: 'failed', reason: 'سبب كافٍ للرفض' })).statusCode, 404);
  assert.equal((await patch('ord-or-4', { status: 'failed', reason: 'سبب كافٍ للرفض' }, OUTSIDER)).statusCode, 403, 'manage_orders is needed');
  assert.equal(await status('ord-or-4'), 'pending');
});
