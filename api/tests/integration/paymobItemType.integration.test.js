'use strict';
/**
 * A card payment is booked as what it bought. Every Paymob payment used to be
 * written payment_type='COURSE' and journalled to course revenue (4100), so a
 * consultation paid online counted as a course sale — in course balances,
 * booking bonuses and the revenue split — and not as a consultation.
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
const TENANT = 'tenant-sec2-paymob-it';
let pool;

async function clean() {
  const [pays] = await pool.query('SELECT id FROM payments WHERE tenant_id=?', [TENANT]).catch(() => [[]]);
  const ids = pays.map(p => p.id);
  if (ids.length) {
    await pool.query(
      'DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=? AND ref_id IN (?))', [TENANT, ids]
    ).catch(() => {});
  }
  for (const table of [
    'journal_entries', 'payment_audit_log', 'finance_outbox', 'payments', 'consultation_requests',
    'enrollments', 'entitlement_events', 'subscribers', 'leads', 'orders', 'courses', 'notifications',
    'outbox_events', 'tenant_settings', 'message_outbox', 'financial_documents', 'loyalty_ledger',
    'finance_document_sequences', 'consultations', 'client_code_counter', 'tenant_chart_of_accounts',
  ]) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
  await pool.query('DELETE FROM tenants WHERE id=?', [TENANT]).catch(() => {});
}

async function order(id, type, itemId, amount) {
  await pool.query(
    `INSERT INTO orders (id, tenant_id, item_id, item_title, type, status, amount, currency, customer_name, customer_email, customer_phone)
     VALUES (?, ?, ?, 'بند', ?, 'pending', ?, 'EGP', 'عميلة', ?, ?)`,
    [id, TENANT, itemId, type, amount, `${id}@example.test`, `10120${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`]);
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await pool.query("INSERT INTO tenants (id, slug, name, status) VALUES (?, ?, 'Paymob item type IT', 'suspended')", [TENANT, TENANT]);
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type)
     VALUES ('sec2-co-1', ?, 'كورس', '', '', '', '', 'GENERAL', 'RECORDED')`, [TENANT]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('the payment type is read from the order, in the desk\'s vocabulary', () => {
  const { paymobPaymentType } = require('../../lib/paymobFinalise');
  assert.equal(paymobPaymentType('CONSULTATION'), 'CONSULTATION');
  assert.equal(paymobPaymentType('consultation'), 'CONSULTATION');
  assert.equal(paymobPaymentType('BUNDLE'), 'BUNDLE');
  assert.equal(paymobPaymentType('course'), 'COURSE');
  assert.equal(paymobPaymentType('OTHER'), 'OTHER');
  assert.equal(paymobPaymentType('something-else'), 'OTHER');
});

test('a consultation paid by card is a consultation payment and consultation revenue', { skip }, async () => {
  const { finalisePaymobOrder } = require('../../lib/paymobFinalise');
  await order('sec2-cons-1', 'CONSULTATION', 'consultation', 600);
  const result = await finalisePaymobOrder('sec2-cons-1', 'sec2-txn-cons-1', { amountCents: 60000, currency: 'EGP' }, TENANT);
  assert.notEqual(result.found, false);
  const [[payment]] = await pool.query("SELECT payment_type, course_id FROM payments WHERE tenant_id=? AND id='paymob-sec2-cons-1'", [TENANT]);
  assert.equal(payment.payment_type, 'CONSULTATION');
  assert.equal(payment.course_id, null);
  const [lines] = await pool.query(
    `SELECT jl.account_code FROM journal_entry_lines jl JOIN journal_entries je ON je.id=jl.entry_id
      WHERE je.tenant_id=? AND je.ref_id='paymob-sec2-cons-1' AND jl.credit > 0`, [TENANT]);
  assert.deepEqual(lines.map(l => l.account_code), ['4200'], 'consultation revenue, not course revenue');
});

test('a course paid by card is still a course payment', { skip }, async () => {
  const { finalisePaymobOrder } = require('../../lib/paymobFinalise');
  await order('sec2-course-1', 'COURSE', 'sec2-co-1', 900);
  await finalisePaymobOrder('sec2-course-1', 'sec2-txn-course-1', { amountCents: 90000, currency: 'EGP' }, TENANT);
  const [[payment]] = await pool.query("SELECT payment_type, course_id FROM payments WHERE tenant_id=? AND id='paymob-sec2-course-1'", [TENANT]);
  assert.equal(payment.payment_type, 'COURSE');
  assert.equal(payment.course_id, 'sec2-co-1');
});
