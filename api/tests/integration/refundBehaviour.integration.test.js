'use strict';
/**
 * Refunds through the real app, as the desk makes them: a request filed by
 * POST /api/admin/refund-requests/by-admin and decided by PUT
 * /api/admin/finance/refunds/:id, signed in as an administrator, against a
 * real MariaDB.
 *
 * Part of a payment back is its own negative row out of the same box, with its
 * own journal entry; the payment, the course and the instructor's and rep's
 * shares keep the part that stayed. The next refund is measured against what
 * is left, nothing or a negative is no refund, and a full refund marks the
 * payment refunded, closes the course, cancels the commission and the fee,
 * flips the order and books a reversal. Replaces the source-text checks that
 * read lib/refunds.js and routes/finance for these shapes.
 * Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
const skip = !ENABLED && 'no DB_* configured';
const { startApp, signInStaff, ensureTenant } = require('./support/http');

const T = 'tenant-refund-it';
const BOX = 'خزنة الدقي - كاش';
let pool; let app; let admin;

async function seed() {
  await ensureTenant(pool, T);
  for (const course of ['co-rf-1', 'co-rf-2', 'co-rf-3', 'co-rf-4']) {
    await pool.query(
      `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp)
       VALUES (?, ?, ?, '', '', '', '', 'GENERAL', 'RECORDED', 1000)`, [course, T, course]);
  }
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, name, phone, email, is_active, created_at)
     VALUES ('sub-rf', ?, 'عميلة الاسترداد', '01012340000', 'rf@example.test', 1, UTC_TIMESTAMP())`, [T]);
  for (const [id, course, amount, tx] of [['pay-rf-1', 'co-rf-1', 1000, null], ['pay-rf-2', 'co-rf-2', 600, 'tx-rf-2'],
    ['pay-rf-3', 'co-rf-3', 400, null], ['pay-rf-4', 'co-rf-4', 500, null]]) {
    await pool.query(
      `INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, currency, amount_egp, payment_type, payment_method,
                             status, date, transaction_id, created_at)
       VALUES (?, ?, 'sub-rf', ?, ?, 'EGP', ?, 'COURSE', ?, 'paid', CURDATE(), ?, UTC_TIMESTAMP())`,
      [id, T, course, amount, amount, BOX, tx]);
    await pool.query(
      `INSERT INTO enrollments (id, tenant_id, subscriber_id, course_id, enrolled_at, status, entitlement_source)
       VALUES (?, ?, 'sub-rf', ?, UTC_TIMESTAMP(), 'active', 'manual')`, [`en-${id}`, T, course]);
    await pool.query(
      `INSERT INTO crm_commissions (id, tenant_id, staff_id, payment_id, payment_amount, commission_amount, month, year, status)
       VALUES (?, ?, 'st-rf-rep', ?, ?, ?, 10, 2026, 'PENDING')`, [`cm-${id}`, T, id, amount, amount / 10]);
    await pool.query(
      `INSERT INTO instructor_fees (id, tenant_id, staff_id, course_id, source_payment_id, fee_type, fixed_amount, total_amount,
                                    currency, status, period_month, period_year)
       VALUES (?, ?, 'st-rf-teacher', ?, ?, 'fixed', ?, ?, 'EGP', 'approved', 10, 2026)`,
      [`fee-${id}`, T, course, id, amount * 0.3, amount * 0.3]);
  }
  await pool.query(
    `INSERT INTO orders (id, tenant_id, type, item_id, item_title, amount, currency, customer_name, status, subscriber_id,
                         course_id, transaction_id, created_at, paid_at)
     VALUES ('ord-rf-2', ?, 'course', 'co-rf-2', 'co-rf-2', 600, 'EGP', 'عميلة', 'paid', 'sub-rf', 'co-rf-2', 'tx-rf-2',
             UTC_TIMESTAMP(), UTC_TIMESTAMP())`, [T]);
}

const one = async (sql, params) => (await pool.query(sql, params))[0][0];

async function fileAndDecide(paymentId, amount, decision = { status: 'APPROVED' }) {
  const filed = await app.call('POST', '/api/admin/refund-requests/by-admin', {
    session: admin, body: { subscriber_id: 'sub-rf', payment_id: paymentId, amount, currency: 'EGP', reason: 'طلب العميلة' },
  });
  if (filed.status !== 200) return { filed, decided: null };
  const decided = await app.call('PUT', `/api/admin/finance/refunds/${filed.body.id}`, { session: admin, body: decision });
  return { filed, decided };
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await seed();
  app = await startApp(pool);
  admin = await signInStaff(pool, app, { tenantId: T, id: 'st-rf-admin', role: 'ADMIN', name: 'مدير الاسترداد' });
});

after(async () => {
  if (!ENABLED) return;
  if (app) await app.close();
  await pool.end().catch(() => {});
});

test('nothing, or less than nothing, is not a refund', { skip }, async () => {
  for (const amount of [0, -50]) {
    const { filed } = await fileAndDecide('pay-rf-1', amount);
    assert.equal(filed.status, 400, `amount ${amount}: ${filed.text}`);
  }
});

test('part of a payment back is a negative row out of the same box, and the course stays open', { skip }, async () => {
  const { filed, decided } = await fileAndDecide('pay-rf-1', 300);
  assert.equal(filed.status, 200, filed.text);
  assert.equal(decided.status, 200, decided.text);

  const original = await one('SELECT status, amount FROM payments WHERE id=?', ['pay-rf-1']);
  assert.equal(original.status, 'paid', 'the payment still says what was paid');
  assert.equal(Number(original.amount), 1000);
  const [rows] = await pool.query(
    "SELECT id, amount, payment_method, status FROM payments WHERE tenant_id=? AND subscriber_id='sub-rf' AND amount < 0", [T]);
  assert.equal(rows.length, 1, 'one row for the money going out');
  assert.equal(Number(rows[0].amount), -300);
  assert.equal(rows[0].payment_method, BOX, 'out of the box the money was taken into');
  const journal = await one('SELECT COUNT(*) AS n FROM journal_entries WHERE tenant_id=? AND ref_id=?', [T, rows[0].id]);
  assert.ok(Number(journal.n) >= 1, 'with a journal entry of its own');

  assert.equal((await one("SELECT status FROM enrollments WHERE id='en-pay-rf-1'")).status, 'active');
  const commission = await one("SELECT status, commission_amount FROM crm_commissions WHERE id='cm-pay-rf-1'");
  assert.equal(commission.status, 'PENDING');
  assert.equal(Number(commission.commission_amount), 70, 'the commission follows the 700 that stayed');
  const fee = await one("SELECT status, total_amount FROM instructor_fees WHERE id='fee-pay-rf-1'");
  assert.equal(fee.status, 'approved');
  assert.equal(Number(fee.total_amount), 210, 'and so does the instructor\'s share');
});

test('the next refund is measured against what is left, not the original amount', { skip }, async () => {
  // 800 is less than the 1000 paid but more than the 700 still refundable.
  const { filed, decided } = await fileAndDecide('pay-rf-1', 800);
  assert.equal(filed.status, 200, filed.text);
  assert.equal(decided.status, 409, decided.text);
  assert.match(decided.body.error, /المتبقي القابل للاسترداد \(700\)/);
  const [rows] = await pool.query("SELECT id FROM payments WHERE tenant_id=? AND amount < 0", [T]);
  assert.equal(rows.length, 1, 'nothing more went out');
  const request = await one('SELECT status FROM refund_requests WHERE id=?', [filed.body.id]);
  assert.equal(request.status, 'PENDING', 'the refused decision was rolled back whole');
});

test('more than the payment is refused when filed', { skip }, async () => {
  const { filed } = await fileAndDecide('pay-rf-2', 601);
  assert.equal(filed.status, 409, filed.text);
});

test('a full refund marks the payment refunded and takes back everything that hung on it', { skip }, async () => {
  const { filed, decided } = await fileAndDecide('pay-rf-2', 600);
  assert.equal(filed.status, 200, filed.text);
  assert.equal(decided.status, 200, decided.text);
  assert.equal((await one("SELECT status FROM payments WHERE id='pay-rf-2'")).status, 'refunded');
  assert.equal((await one("SELECT status FROM enrollments WHERE id='en-pay-rf-2'")).status, 'revoked');
  assert.equal((await one("SELECT status FROM crm_commissions WHERE id='cm-pay-rf-2'")).status, 'CANCELLED');
  assert.equal((await one("SELECT status FROM instructor_fees WHERE id='fee-pay-rf-2'")).status, 'rejected');
  assert.equal(String((await one("SELECT status FROM orders WHERE id='ord-rf-2'")).status).toLowerCase(), 'refunded');
  const reversal = await one(
    "SELECT total_debit, total_credit FROM journal_entries WHERE tenant_id=? AND ref_type='refund' AND ref_id='pay-rf-2'", [T]);
  assert.ok(reversal, 'a refund journal entry');
  assert.equal(Number(reversal.total_debit), 600);
  assert.equal(Number(reversal.total_credit), 600);
  // And it cannot be refunded a second time.
  const again = await fileAndDecide('pay-rf-2', 600);
  assert.notEqual(again.filed.status, 200, 'a refunded payment is no longer eligible');
});

test('refunds are decided at one address: the old duplicate approval route is gone', { skip }, async () => {
  const res = await app.call('PATCH', '/api/admin/refund-requests/some-id', { session: admin, body: { status: 'APPROVED' } });
  assert.equal(res.status, 404);
});

test('two people approving the same request at once refund it once', { skip }, async () => {
  const filed = await app.call('POST', '/api/admin/refund-requests/by-admin', {
    session: admin, body: { subscriber_id: 'sub-rf', payment_id: 'pay-rf-3', amount: 100, currency: 'EGP', reason: 'مرتين' },
  });
  assert.equal(filed.status, 200, filed.text);
  const both = await Promise.all([1, 2].map(() =>
    app.call('PUT', `/api/admin/finance/refunds/${filed.body.id}`, { session: admin, body: { status: 'APPROVED' } })));
  assert.deepEqual(both.map(r => r.status).sort(), [200, 409], both.map(r => r.text).join(' | '));
  const [rows] = await pool.query("SELECT id FROM payments WHERE tenant_id=? AND course_id='co-rf-3' AND amount < 0", [T]);
  assert.equal(rows.length, 1, 'one row of money out, not two');
});

test('a refund dated in a closed accounting period is refused and writes nothing', { skip }, async () => {
  const month = new Date().toISOString().slice(0, 7);
  await pool.query(
    "INSERT INTO accounting_periods (id, tenant_id, period_label, status, closed_at) VALUES ('ap-rf', ?, ?, 'closed', UTC_TIMESTAMP())",
    [T, month]);
  try {
    const { filed, decided } = await fileAndDecide('pay-rf-4', 500);
    assert.equal(filed.status, 200, filed.text);
    assert.equal(decided.status, 409, decided.text);
    assert.match(decided.body.error, /مقفولة/);
    assert.equal((await one("SELECT status FROM payments WHERE id='pay-rf-4'")).status, 'paid');
    assert.equal((await one("SELECT status FROM enrollments WHERE id='en-pay-rf-4'")).status, 'active');
    assert.equal((await one('SELECT status FROM refund_requests WHERE id=?', [filed.body.id])).status, 'PENDING');
  } finally {
    await pool.query("DELETE FROM accounting_periods WHERE id='ap-rf'");
  }
});
