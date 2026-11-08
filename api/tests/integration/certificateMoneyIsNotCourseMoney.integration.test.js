'use strict';
/**
 * 29 Oct 2026: «بنرفع قسط شهاده يروح يسمع الفلوس في الكورس وبلغي الشهاده». A certificate payment names the client's course and carries the
 * certificate's price in course_expected; it is not the course's money. On a real MariaDB, with one course payment and one certificate payment
 * on the same course: the course's agreed price and its «paid» come from the course's own payment only; taking the certificate instalment back
 * leaves the course open; taking the course payment back closes the course even though a certificate payment remains. (This replaces a test that
 * matched `payment_type IS NULL OR payment_type IN ('COURSE','BUNDLE','OTHER')` in six source files.) Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-certmoney-it';
const SUB = 'sub-cm-money'; const COURSE = 'co-cm-money';
let pool;

async function clean() {
  await pool.query('DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)', [T]).catch(() => {});
  for (const table of ['lecture_completions', 'course_lectures', 'journal_entries', 'payment_audit_log', 'financial_audit_log', 'entitlement_events', 'enrollments', 'payments', 'subscribers', 'courses', 'tenant_settings', 'outbox']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}
const pay = (id, type, amount, expected, extra = '') => pool.query(
  `INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, currency, status, payment_type, course_expected, amount_egp, date${extra ? ', certificate_request_id' : ''})
   VALUES (?, ?, ?, ?, ?, 'EGP', 'paid', ?, ?, ?, NOW()${extra ? ', ?' : ''})`,
  [id, T, SUB, COURSE, amount, type, expected, amount, ...(extra ? [extra] : [])]);
const accessStatus = async () => (await pool.query('SELECT status FROM enrollments WHERE tenant_id=? AND subscriber_id=? AND course_id=?', [T, SUB, COURSE]))[0][0]?.status;

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp)
     VALUES (?, ?, 'كورس', '', '', '', '', 'GENERAL', 'RECORDED', 3400)`, [COURSE, T]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, branch, branch_id) VALUES (?, ?, 'عميل', '1019200001', 'ONLINE_EGYPT', 'branch-online-egypt')", [SUB, T]);
  await pay('p-cm-course', 'COURSE', 1000, 3000);
  await pay('p-cm-cert', 'CERTIFICATE', 300, 5000);
  await pool.query("INSERT INTO course_lectures (id, course_id, title, lecture_type, video_url, sort_order, is_published) VALUES ('lec-cm-1', ?, 'محاضرة', 'RECORDED', '', 1, 1)", [COURSE]);
  await pool.query("INSERT INTO lecture_completions (id, tenant_id, subscriber_id, lecture_id, course_id, progress_pct, completed_at) VALUES ('lc-cm-1', ?, ?, 'lec-cm-1', ?, 100, NOW())", [T, SUB, COURSE]);
  await pool.query(
    "INSERT INTO enrollments (id, tenant_id, subscriber_id, course_id, enrolled_at, status, access_type) VALUES ('en-cm-1', ?, ?, ?, NOW(), 'active', 'full')", [T, SUB, COURSE]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('the course\'s agreed price and its paid amount are the course payment\'s, not the certificate\'s', { skip }, async () => {
  const { agreedPrice, itemBalances } = require('../../lib/agreedPrice');
  assert.equal(await agreedPrice(pool, { tenantId: T, subscriberId: SUB, courseId: COURSE, currency: 'EGP' }), 3000,
    'the certificate\'s 5,000 is not the course price');
  const line = (await itemBalances(pool, { tenantId: T, subscriberId: SUB })).get(COURSE);
  assert.deepEqual([Number(line.expected), Number(line.paid), Number(line.remaining)], [3000, 1000, 2000], 'the 300 of the certificate is not paid on the course');
});

test('the automatic certificate sweep counts the course payment only as what the client paid', { skip }, async () => {
  const { CANDIDATES_SQL } = require('../../lib/autoCertificate');
  const [rows] = await pool.query(CANDIDATES_SQL, [T, '']);
  const row = rows.find(candidate => candidate.course_id === COURSE);
  assert.ok(row, 'the enrolled client who watched the lecture is a candidate');
  assert.equal(Number(row.paid_egp), 1000, 'the 300 of the certificate is not money for the course, so it cannot help the course reach its paid share');
});

test('taking the certificate instalment back leaves the course open; taking the course payment back closes it', { skip }, async () => {
  const { revokeAccessWithoutOtherGrant } = require('../../lib/refunds');
  const conn = await pool.getConnection();
  try {
    await revokeAccessWithoutOtherGrant(conn, { tenantId: T, actor: 'a', pay: { id: 'p-cm-cert', subscriber_id: SUB, course_id: COURSE, bundle_id: null, payment_type: 'CERTIFICATE' } });
    assert.equal(await accessStatus(), 'active', 'the certificate instalment is not what opens the course');
    await revokeAccessWithoutOtherGrant(conn, { tenantId: T, actor: 'a', pay: { id: 'p-cm-course', subscriber_id: SUB, course_id: COURSE, bundle_id: null, payment_type: 'COURSE' } });
    assert.notEqual(await accessStatus(), 'active', 'with only a certificate payment left there is no payment for the course');
  } finally { conn.release(); }
});

test('voiding a paid certificate instalment does not run the course close-down', { skip }, async () => {
  await pool.query("UPDATE enrollments SET status='active' WHERE id='en-cm-1'");
  const { voidPayment } = require('../../lib/paymentCorrections');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await voidPayment(conn, { tenantId: T, paymentId: 'p-cm-cert', actor: 'boss@example.test', reason: 'اتسجل بالغلط' });
    await conn.commit();
    assert.equal(out.voided, true);
  } finally { conn.release(); }
  assert.equal(await accessStatus(), 'active', 'the course is open as before');
  const [[row]] = await pool.query("SELECT deleted_at FROM payments WHERE id='p-cm-cert'");
  assert.ok(row.deleted_at, 'and the certificate payment itself is voided');
});
