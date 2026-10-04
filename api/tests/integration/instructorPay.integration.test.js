'use strict';
/**
 * Instructor pay (migration 234, lib/instructorPay.js) against a real MariaDB:
 * a Dokki week held is a lecture paid by the lecture or the hour, an online
 * session that ended likewise, a client returning to an instructor earns them
 * the retention bonus, a refund takes it back, and a rate change goes through
 * a second person. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-instructor-pay-it';
let pool;

const handler = (router, method, path) => {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method} ${path}`);
  return layer.route.stack.at(-1).handle;
};
async function call(router, method, path, { params = {}, body = {}, query = {}, staff = null }) {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  await handler(router, method, path)({
    params, body, query, headers: {}, tenantId: TENANT, user: { uid: staff?.id || 'admin', email: 'a@example.test' },
    staffRecord: staff, isSuperAdmin: !staff, ip: '127.0.0.1', get: () => undefined,
  }, res);
  return res;
}
const fees = async (where = '1=1') => (await pool.query(
  `SELECT staff_id, fee_type, status, total_amount, hours, source_key FROM instructor_fees WHERE tenant_id=? AND ${where} ORDER BY created_at, source_key`, [TENANT]))[0]
  .map(f => ({ ...f, total_amount: Number(f.total_amount), hours: f.hours === null ? null : Number(f.hours) }));

async function clean() {
  await pool.query("DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)", [TENANT]).catch(() => {});
  for (const table of ['journal_entries', 'payment_audit_log', 'refunds', 'crm_commissions', 'instructor_fees', 'instructor_rate_change_requests',
    'audit_events', 'entitlement_events', 'enrollments', 'payments', 'daqqi_attendees', 'daqqi_rounds', 'live_sessions', 'subscribers',
    'courses', 'therapists', 'instructor_rates', 'staff']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES
       ('st-dr-a', ?, 'د. أمل', 'amal@example.test', '1016000001', 'INSTRUCTOR', 1, '2025-01-01'),
       ('st-dr-b', ?, 'د. باسم', 'basem@example.test', '1016000002', 'INSTRUCTOR', 1, '2025-01-01'),
       ('st-hr-1', ?, 'HR واحد', 'hr1@example.test', '1016000003', 'HR', 1, '2025-01-01'),
       ('st-hr-2', ?, 'HR اتنين', 'hr2@example.test', '1016000004', 'HR', 1, '2025-01-01')`, [TENANT, TENANT, TENANT, TENANT]);
  await pool.query("INSERT INTO therapists (id, tenant_id, name, specialty, image, staff_id, is_active) VALUES ('th-a', ?, 'د. أمل', '', '', 'st-dr-a', 1)", [TENANT]);
  // Amal: 500 a lecture, a 200 fixed retention bonus. Basem: 300 an hour (2h lectures), 10% retention.
  await pool.query(
    `INSERT INTO instructor_rates (id, tenant_id, staff_id, pay_basis, lecture_rate, lecture_rate_per_hour, lecture_hours, revenue_share_pct,
                                   retention_bonus_type, retention_bonus_value, currency) VALUES
       (UUID(), ?, 'st-dr-a', 'per_lecture', 500, NULL, NULL, 30, 'fixed', 200, 'EGP'),
       (UUID(), ?, 'st-dr-b', 'per_hour', NULL, 300, 2, NULL, 'percentage', 10, 'EGP')`, [TENANT, TENANT]);
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, instructor_id, price_egp) VALUES
       ('co-a1', ?, 'كورس أمل 1', '', '', '', '', 'GENERAL', 'RECORDED', 'st-dr-a', 2000),
       ('co-a2', ?, 'كورس أمل 2', '', '', '', '', 'GENERAL', 'RECORDED', 'st-dr-a', 3000),
       ('co-b1', ?, 'كورس باسم', '', '', '', '', 'GENERAL', 'LIVE', 'st-dr-b', 1500)`, [TENANT, TENANT, TENANT]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone) VALUES ('sub-ip-1', ?, 'عميلة راجعة', '1016000005')", [TENANT]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('a Dokki week marked held is a lecture at the instructor\'s rate — once — and unmarking takes it back', { skip }, async () => {
  const router = require('../../routes/daqqi-rounds');
  const round = { id: 'rd-1', courseId: 'co-a1', instructorId: 'th-a', instructorName: 'د. أمل', dayOfWeek: 'السبت', timeSlot: 'مساءً',
    status: 'active', startDate: '2026-09-05T18:00:00', currentLecture: 1, postponedWeeks: [] };
  const save = heldWeeks => call(router, 'post', '/api/admin/daqqi-rounds', { body: { ...round, heldWeeks } });
  let res = await save([]);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  res = await save(['2026-09-26', '2026-10-03']);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  await save(['2026-09-26', '2026-10-03']); // the screen saves the round again
  assert.deepEqual(await fees("fee_type='lecture'"), [
    { staff_id: 'st-dr-a', fee_type: 'lecture', status: 'pending', total_amount: 500, hours: null, source_key: 'daqqi:rd-1:2026-09-26' },
    { staff_id: 'st-dr-a', fee_type: 'lecture', status: 'pending', total_amount: 500, hours: null, source_key: 'daqqi:rd-1:2026-10-03' },
  ], 'the therapist is paid through their staff account, 500 a lecture, one row a week');
  await save(['2026-09-26']);
  assert.equal((await fees("fee_type='lecture'")).length, 1, 'the week unmarked takes its pending fee back');
});

test('an online session that ended is a lecture paid by the hour for its own length', { skip }, async () => {
  const router = require('../../routes/lms');
  await pool.query(
    `INSERT INTO live_sessions (id, tenant_id, course_id, title, platform, meeting_url, starts_at, duration_min, status)
     VALUES ('ls-1', ?, 'co-b1', 'جلسة 1', 'zoom', 'https://zoom.example/1', '2026-10-01 19:00:00', 90, 'live')`, [TENANT]);
  const res = await call(router, 'patch', '/api/admin/live-sessions/:id', { params: { id: 'ls-1' }, body: { status: 'ended' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(await fees("source_key='live:ls-1'"), [
    { staff_id: 'st-dr-b', fee_type: 'lecture', status: 'pending', total_amount: 450, hours: 1.5, source_key: 'live:ls-1' },
  ], '300 an hour × 1.5 hours');
});

test('a returning client earns the instructor the retention bonus once; a first course does not; a lecture instructor takes no revenue share', { skip }, async () => {
  const { recordPaymentCompensation } = require('../../lib/paymentCompensation');
  const pay = async (id, courseId, amount, date) => {
    await pool.query(
      `INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, amount_egp, currency, payment_type, payment_method, status, date)
       VALUES (?, ?, 'sub-ip-1', ?, ?, ?, 'EGP', 'COURSE', 'cash', 'paid', ?)`, [id, TENANT, courseId, amount, amount, date]);
    const conn = await pool.getConnection();
    try { await conn.beginTransaction(); await recordPaymentCompensation({ paymentId: id, tenantId: TENANT, actor: 'test' }, conn); await conn.commit(); }
    finally { conn.release(); }
  };
  await pay('pay-ip-1', 'co-a1', 2000, '2026-09-10');
  assert.deepEqual(await fees("fee_type IN ('retention','fixed')"), [], 'first course with Amal: no bonus; per-lecture: no share of the payment');
  await pay('pay-ip-2', 'co-a2', 1500, '2026-10-02');
  await pay('pay-ip-3', 'co-a2', 1500, '2026-10-20'); // the second instalment of the same course
  assert.deepEqual(await fees("fee_type='retention'"), [
    { staff_id: 'st-dr-a', fee_type: 'retention', status: 'pending', total_amount: 200, hours: null, source_key: 'retention:sub-ip-1:co-a2' },
  ], 'one fixed bonus for the client and the course');
});

test('the payment that earned the bonus refunded: the bonus goes', { skip }, async () => {
  const { applyRefundReversal } = require('../../lib/refunds');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await applyRefundReversal({ paymentId: 'pay-ip-2', subscriberId: 'sub-ip-1', refundAmount: 1500, refundCurrency: 'EGP', tenantId: TENANT, actor: 'test' }, conn);
    await conn.commit();
  } finally { conn.release(); }
  assert.equal((await fees("fee_type='retention'"))[0].status, 'rejected');
});

test('a rate change is a request another person approves, and then the lectures follow it', { skip }, async () => {
  const router = require('../../routes/hr/compensation');
  const hr1 = { id: 'st-hr-1', name: 'HR واحد', role: 'hr' };
  const hr2 = { id: 'st-hr-2', name: 'HR اتنين', role: 'hr' };
  const bad = await call(router, 'put', '/api/admin/hr/instructors/:staffId/rates', { params: { staffId: 'st-dr-a' }, staff: hr1, body: { pay_basis: 'per_lecture' } });
  assert.equal(bad.statusCode, 400, 'per lecture with no price is refused');
  const put = await call(router, 'put', '/api/admin/hr/instructors/:staffId/rates', {
    params: { staffId: 'st-dr-a' }, staff: hr1,
    body: { pay_basis: 'per_hour', lecture_rate_per_hour: 400, lecture_hours: 3, retention_bonus_type: 'percentage', retention_bonus_value: 5 } });
  assert.equal(put.statusCode, 200, JSON.stringify(put.body));
  const self = await call(router, 'put', '/api/admin/hr/instructor-rate-proposals/:id/status', { params: { id: put.body.id }, staff: hr1, body: { status: 'APPROVED' } });
  assert.equal(self.statusCode, 409, 'the requester cannot approve their own change');
  const ok = await call(router, 'put', '/api/admin/hr/instructor-rate-proposals/:id/status', { params: { id: put.body.id }, staff: hr2, body: { status: 'APPROVED' } });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  const { recordDeliveredLecture } = require('../../lib/instructorPay');
  await recordDeliveredLecture(pool, { tenantId: TENANT, instructorId: 'th-a', sourceKey: 'manual-test:1', date: '2026-10-04' });
  assert.deepEqual((await fees("source_key='manual-test:1'")).map(f => [f.total_amount, f.hours]), [[1200, 3]], '400 an hour × 3 hours');

  const summary = await call(router, 'get', '/api/admin/hr/instructor-pay', { query: { month: '10', year: '2026' } });
  assert.equal(summary.statusCode, 200);
  const amal = summary.body.instructors.find(i => i.staff_id === 'st-dr-a');
  assert.equal(amal.pay_basis, 'per_hour');
  assert.ok(summary.body.fees.some(f => f.source_key === 'daqqi:rd-1:2026-10-03') === false && summary.body.fees.length >= 2);
});
