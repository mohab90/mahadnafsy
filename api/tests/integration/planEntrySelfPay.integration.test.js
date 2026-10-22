'use strict';
/**
 * A client pays the 2nd and 3rd instalment of their plan from their dashboard:
 * the server sets the amount from the plan, only the plan's own client can open
 * the order, a repeated Paymob callback credits nothing twice, and each paid
 * entry opens more of the course — the last one all of it. The 3rd goes through
 * the receipt upload and the accounts' approval.
 * Against a real MariaDB; runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-product-plan-it';
const COURSE = 'co-prod-plan-1';
const PLAN = 'plan-prod-1';
let pool; let mePayments; let proofs; let finalisePaymobOrder;

const TABLES = ['payment_audit_log', 'financial_audit_log', 'finance_outbox', 'message_outbox', 'outbox',
  'crm_commissions', 'instructor_fees', 'entitlement_events', 'enrollments', 'payment_attempts', 'payment_intents',
  'payment_proofs', 'payments', 'orders', 'installment_plans', 'lead_events', 'leads', 'subscribers', 'courses',
  'notifications', 'job_queue', 'financial_documents', 'loyalty_points', 'loyalty_transactions'];
async function clean() {
  await pool.query('DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)', [TENANT]).catch(() => {});
  await pool.query('DELETE FROM journal_entries WHERE tenant_id=?', [TENANT]).catch(() => {});
  for (const table of TABLES) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  await pool.query('DELETE FROM course_lectures WHERE course_id=?', [COURSE]).catch(() => {});
}

function handler(router, method, path) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method} ${path} is a route`);
  return layer.route.stack.at(-1).handle;
}
async function call(router, method, path, { params = {}, body = {}, uid = 'uid-prod-a', admin = false } = {}) {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  await handler(router, method, path)({
    params, body, query: {}, headers: {}, tenantId: TENANT, ip: '127.0.0.1', get: () => undefined,
    user: admin ? { uid: 'staff-1', email: 'acc@example.test' } : { uid },
    ...(admin ? { isSuperAdmin: true } : {}),
  }, res);
  return res;
}
const checkout = (index, extra = {}) => call(mePayments, 'post', '/api/me/installments/:planId/entries/:index/checkout',
  { params: { planId: PLAN, index: String(index) }, ...extra });
const planRow = async () => (await pool.query('SELECT paid_dates, paid_count, status FROM installment_plans WHERE id=? AND tenant_id=?', [PLAN, TENANT]))[0][0];
const enrolment = async () => (await pool.query(
  'SELECT access_type, lecture_limit FROM enrollments WHERE tenant_id=? AND subscriber_id=? AND course_id=?', [TENANT, 'sub-prod-a', COURSE]))[0][0];

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  mePayments = require('../../routes/me-payments');
  proofs = require('../../routes/payment-proofs');
  ({ finalisePaymobOrder } = require('../../lib/paymobFinalise'));
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp)
     VALUES (?, ?, 'كورس الأقساط', '', '', '', '', 'GENERAL', 'RECORDED', 3000)`, [COURSE, TENANT]);
  for (let i = 1; i <= 6; i++) {
    await pool.query(
      `INSERT INTO course_lectures (id, course_id, title, lecture_type, video_url, duration, sort_order, is_published)
       VALUES (?, ?, ?, 'RECORDED', '', '10', ?, 1)`, [`lec-prod-${i}`, COURSE, `محاضرة ${i}`, i]);
  }
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, name, phone, branch, firebase_uid) VALUES
       ('sub-prod-a', ?, 'عميلة الأقساط', '1015000001', 'ONLINE_EGYPT', 'uid-prod-a'),
       ('sub-prod-b', ?, 'عميل تاني', '1015000002', 'ONLINE_EGYPT', 'uid-prod-b')`, [TENANT, TENANT]);
  // The first instalment, paid at booking: a third of the price, two of six lectures open.
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, amount_egp, currency, payment_type, payment_method,
       status, date, source, is_installment, course_expected)
     VALUES ('pay-prod-1', ?, 'sub-prod-a', ?, 1000, 1000, 'EGP', 'COURSE', 'كاش', 'paid', '2026-10-01', 'manual', 1, 3000)`, [TENANT, COURSE]);
  await pool.query(
    `INSERT INTO enrollments (id, tenant_id, subscriber_id, course_id, access_type, lecture_limit, status, entitlement_source, branch_id, enrolled_at)
     VALUES (UUID(), ?, 'sub-prod-a', ?, 'limited', 2, 'active', 'manual_payment', 'branch-online-egypt', NOW())`, [TENANT, COURSE]);
  await pool.query(
    `INSERT INTO installment_plans (id, tenant_id, subscriber_id, title, total_amount, currency, installments_count,
       installment_amounts, due_dates, paid_dates, payment_ids, paid_amounts, paid_count, course_id)
     VALUES (?, ?, 'sub-prod-a', 'خطة', 3000, 'EGP', 3, '[1000,1000,1000]', '["2026-10-01","2026-11-01","2026-12-01"]',
       '["2026-10-01",null,null]', '["pay-prod-1",null,null]', '[1000,null,null]', 1, ?)`, [PLAN, TENANT, COURSE]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('the client sees each instalment with what it still owes', { skip }, async () => {
  const res = await call(mePayments, 'get', '/api/me/installments');
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const [plan] = res.body.plans;
  assert.deepEqual(plan.entries.map(e => [e.dueDate, e.due, !!e.paidAt]),
    [['2026-10-01', 0, true], ['2026-11-01', 1000, false], ['2026-12-01', 1000, false]]);
});

test('another client cannot open an order on this plan', { skip }, async () => {
  const res = await checkout(1, { uid: 'uid-prod-b' });
  assert.equal(res.statusCode, 404);
  const [rows] = await pool.query('SELECT id FROM orders WHERE tenant_id=?', [TENANT]);
  assert.equal(rows.length, 0);
});

test('the amount is the plan\'s, whatever the page sends; paid twice, credited once; access widens', { skip }, async () => {
  const res = await checkout(1, { body: { amount: 1, currency: 'USD' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual([res.body.amount, res.body.currency], [1000, 'EGP']);
  const again = await checkout(1);
  assert.equal(again.body.orderId, res.body.orderId, 'the order already open for the entry is reused');

  const first = await finalisePaymobOrder(res.body.orderId, 'txn-prod-1', { amountCents: 100000, currency: 'EGP' }, TENANT);
  assert.deepEqual([first.found, first.alreadyProcessed], [true, false]);
  const second = await finalisePaymobOrder(res.body.orderId, 'txn-prod-1', { amountCents: 100000, currency: 'EGP' }, TENANT);
  assert.equal(second.alreadyProcessed, true);

  const [payments] = await pool.query(
    "SELECT amount, is_installment, course_expected, course_id FROM payments WHERE tenant_id=? AND id LIKE 'paymob-%'", [TENANT]);
  assert.deepEqual(payments.map(p => [Number(p.amount), p.is_installment, Number(p.course_expected), p.course_id]), [[1000, 1, 3000, COURSE]]);
  const plan = await planRow();
  assert.equal(plan.paid_count, 2);
  const paidDates = typeof plan.paid_dates === 'string' ? JSON.parse(plan.paid_dates) : plan.paid_dates;
  assert.ok(paidDates[1], 'the 2nd entry is paid');
  assert.deepEqual({ ...(await enrolment()) }, { access_type: 'limited', lecture_limit: 4 }, 'two thirds paid: four of six lectures');

  const paidAgain = await checkout(1);
  assert.equal(paidAgain.statusCode, 409);
  assert.equal(paidAgain.body.code, 'ENTRY_ALREADY_PAID');
});

test('the last instalment by receipt, approved, completes the plan and opens the whole course', { skip }, async () => {
  const res = await checkout(2, { body: { method: 'transfer' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const upload = await call(proofs, 'post', '/api/me/payment-proof', { body: { order_id: res.body.orderId, payment_method: 'instapay' } });
  assert.equal(upload.statusCode, 200, JSON.stringify(upload.body));
  assert.ok(upload.body.review_due_at, 'the client is told when the review is due');
  const underReview = await checkout(2);
  assert.equal(underReview.statusCode, 409);
  assert.equal(underReview.body.code, 'ENTRY_UNDER_REVIEW');

  const approved = await call(proofs, 'patch', '/api/admin/payment-proofs/:id', { params: { id: upload.body.id }, body: { action: 'approve' }, admin: true });
  assert.equal(approved.statusCode, 200, JSON.stringify(approved.body));
  const plan = await planRow();
  assert.deepEqual([plan.paid_count, plan.status], [3, 'completed']);
  assert.equal((await enrolment()).access_type, 'full');
  const [[proofPayment]] = await pool.query("SELECT is_installment, course_expected FROM payments WHERE tenant_id=? AND id LIKE 'proof-%'", [TENANT]);
  assert.deepEqual([proofPayment.is_installment, Number(proofPayment.course_expected)], [1, 3000]);
});
