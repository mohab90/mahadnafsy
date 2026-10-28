'use strict';
/**
 * Checkout and transfer receipts through the real app, against a real MariaDB.
 *
 * A signed-in customer's checkout is priced by the server whatever the
 * browser sends, two clicks at once make one order, a second visit reuses the
 * pending one, and nobody checks out under another account's address. An
 * accountant's approval of a receipt books one payment however many people
 * press the button, refuses a receipt for an order that has since changed, and
 * a rejection needs a reason. Replaces the source-text checks on
 * routes/lead-capture-crm.js and routes/payment-proofs.js.
 * Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
const skip = !ENABLED && 'no DB_* configured';
const { startApp, signInStaff, signInCustomer, ensureTenant } = require('./support/http');

const T = 'tenant-checkout-it';
const COURSE = 'co-ck-1';
let pool; let app; let customer; let accountant; let quoted;

const one = async (sql, params) => (await pool.query(sql, params))[0][0];
const intent = (body = {}, session = customer) => app.call('POST', '/api/public/checkout-intent', {
  session,
  body: {
    itemId: COURSE, itemType: 'course', itemTitle: 'كورس', customerName: 'مشترية', customerEmail: customer.email,
    customerPhone: '01012345678', payMode: 'cash', amount: 1, currency: 'EGP', ...body,
  },
});

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await ensureTenant(pool, T);
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp, is_published)
     VALUES (?, ?, 'كورس الدفع', '', '', '', '', 'GENERAL', 'RECORDED', 2000, 1)`, [COURSE, T]);
  app = await startApp(pool);
  customer = await signInCustomer(pool, app, { tenantId: T, id: 'sub-ck-1', email: 'buyer.ck@example.test' });
  accountant = await signInStaff(pool, app, { tenantId: T, id: 'st-ck-admin', role: 'ADMIN', name: 'محاسب' });
  const quote = await app.call('POST', '/api/public/price-quote', {
    tenantId: T, body: { itemType: 'course', itemId: COURSE, payMode: 'cash', currency: 'EGP' },
  });
  assert.equal(quote.status, 200, quote.text);
  quoted = quote.body.dueNow;
});

after(async () => {
  if (!ENABLED) return;
  if (app) await app.close();
  await pool.end().catch(() => {});
});

test('a checkout is priced by the server, not by the amount the browser sent', { skip }, async () => {
  const res = await intent({ amount: 1 });
  assert.equal(res.status, 200, res.text);
  assert.equal(Number(res.body.amount), Number(quoted));
  const order = await one('SELECT amount, status, subscriber_id FROM orders WHERE id=?', [res.body.orderId]);
  assert.equal(Number(order.amount), Number(quoted));
  assert.equal(String(order.status).toLowerCase(), 'pending');
  assert.equal(order.subscriber_id, customer.subscriberId, 'on the signed-in customer\'s record');
});

test('two clicks at once, and a second visit later, make one order', { skip }, async () => {
  const both = await Promise.all([intent(), intent()]);
  for (const res of both) assert.ok([200, 409].includes(res.status), res.text);
  const ids = new Set(both.filter(r => r.status === 200).map(r => r.body.orderId));
  const again = await intent();
  assert.equal(again.status, 200, again.text);
  ids.add(again.body.orderId);
  assert.equal(ids.size, 1, `one order id, got ${[...ids].join(', ')}`);
  const [orders] = await pool.query("SELECT id FROM orders WHERE tenant_id=? AND item_id=? AND status='pending'", [T, COURSE]);
  assert.equal(orders.length, 1);
});

test('nobody checks out under another account\'s address, or without signing in', { skip }, async () => {
  const other = await intent({ customerEmail: 'someone.else@example.test' });
  assert.equal(other.status, 403, other.text);
  const anonymous = await app.call('POST', '/api/public/checkout-intent', { tenantId: T, body: { itemId: COURSE, itemType: 'course' } });
  assert.equal(anonymous.status, 401);
});

async function proofFor(id, amount) {
  const order = await one("SELECT id, amount FROM orders WHERE tenant_id=? AND item_id=? AND status='pending' LIMIT 1", [T, COURSE]);
  await pool.query(
    `INSERT INTO payment_proofs (id, tenant_id, order_id, subscriber_id, course_id, item_type, amount, currency, payment_method,
                                 proof_image, status, submitted_at, branch_id)
     VALUES (?, ?, ?, ?, ?, 'course', ?, 'EGP', 'instapay', 'proof.jpg', 'PENDING', UTC_TIMESTAMP(), 'branch-other')`,
    [id, T, order.id, customer.subscriberId, COURSE, amount ?? order.amount]);
  return order;
}

test('a receipt for an order that changed since it was uploaded is not approved', { skip }, async () => {
  await proofFor('pp-ck-stale', 123);
  const res = await app.call('PATCH', '/api/admin/payment-proofs/pp-ck-stale', { session: accountant, body: { action: 'approve' } });
  assert.equal(res.status, 409, res.text);
  assert.equal(res.body.code, 'ORDER_CHANGED_SINCE_PROOF');
  const rejected = await app.call('PATCH', '/api/admin/payment-proofs/pp-ck-stale', { session: accountant, body: { action: 'reject' } });
  assert.equal(rejected.status, 400, 'a rejection says why');
  const withReason = await app.call('PATCH', '/api/admin/payment-proofs/pp-ck-stale', {
    session: accountant, body: { action: 'reject', reviewer_note: 'المبلغ مختلف عن الطلب' },
  });
  assert.equal(withReason.status, 200, withReason.text);
  assert.equal((await one("SELECT status FROM payment_proofs WHERE id='pp-ck-stale'")).status, 'REJECTED');
});

test('two approvals of one receipt at once book one payment, with its journal entry', { skip }, async () => {
  await proofFor('pp-ck-1');
  const both = await Promise.all([1, 2].map(() =>
    app.call('PATCH', '/api/admin/payment-proofs/pp-ck-1', { session: accountant, body: { action: 'approve' } })));
  assert.deepEqual(both.map(r => r.status).sort(), [200, 409], both.map(r => r.text).join(' | '));
  const [payments] = await pool.query("SELECT id, status, amount FROM payments WHERE tenant_id=? AND transaction_id='pp-ck-1'", [T]);
  assert.equal(payments.length, 1);
  assert.equal(payments[0].id, 'proof-pp-ck-1');
  assert.equal(payments[0].status, 'paid');
  const journal = await one("SELECT COUNT(*) AS n FROM journal_entries WHERE tenant_id=? AND ref_id='proof-pp-ck-1'", [T]);
  assert.ok(Number(journal.n) >= 1, 'posted to the ledger in the same approval');
  const late = await app.call('PATCH', '/api/admin/payment-proofs/pp-ck-1', { session: accountant, body: { action: 'approve' } });
  assert.equal(late.status, 409);
});
