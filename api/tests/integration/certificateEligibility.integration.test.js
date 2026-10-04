'use strict';
/**
 * Who may ask for a certificate: enrolled, completed, and paid — where paid
 * includes «مدفوع قبل السيستم», as on every balance. Against a real MariaDB;
 * runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-cert-it';
let pool; let eligible;

const client = async (id, crm) => {
  await pool.query('INSERT INTO subscribers (id, tenant_id, name, phone, crm_json) VALUES (?,?,?,?,?)',
    [id, TENANT, id, `10150${String(Math.random()).slice(2, 7)}`, crm ? JSON.stringify(crm) : null]);
  await pool.query("INSERT INTO enrollments (id, tenant_id, subscriber_id, course_id, status, enrolled_at) VALUES (UUID(), ?, ?, 'co-c-1', 'active', NOW())", [TENANT, id]);
  await pool.query("INSERT INTO course_completions (id, tenant_id, subscriber_id, course_id, certificate_code, status) VALUES (UUID(), ?, ?, 'co-c-1', ?, 'active')", [TENANT, id, `CERT-${id}`]);
};

// Rows a run left behind (an interrupted run, a failed delete) must not
// break the next one: cleared before as well as after.
async function clean() {
  for (const table of ['certificate_events', 'outbox', 'payments', 'course_completions', 'enrollments', 'subscribers', 'bundle_courses', 'bundles', 'courses']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  ({ certificateEligible: eligible } = require('../../routes/certificates'));
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp)
     VALUES ('co-c-1', ?, 'كورس', '', '', '', '', 'GENERAL', 'RECORDED', 900),
            ('co-c-2', ?, 'كورس تاني', '', '', '', '', 'GENERAL', 'RECORDED', 900)`, [TENANT, TENANT]);
  await pool.query("INSERT INTO bundles (id, tenant_id, title, description) VALUES ('bu-c-1', ?, 'مسار', '')", [TENANT]);
  await pool.query("INSERT INTO bundle_courses (tenant_id, bundle_id, course_id) VALUES (?, 'bu-c-1', 'co-c-1')", [TENANT]);
  await client('paid-row');
  await pool.query("INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, currency, status, date) VALUES ('pc-1', ?, 'paid-row', 'co-c-1', 900, 'EGP', 'paid', CURDATE())", [TENANT]);
  await client('prior-course', { priorPaid: { 'co-c-1': 900 } });
  await client('prior-track', { priorPaid: { 'bundle:bu-c-1': 2500 } });
  await client('unpaid');
  await client('refund-only');
  await pool.query("INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, currency, status, date, source) VALUES ('pc-2', ?, 'refund-only', 'co-c-1', -900, 'EGP', 'paid', CURDATE(), 'refund')", [TENANT]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('paid by a payment row, before the system for the course or for its track: eligible', { skip }, async () => {
  for (const id of ['paid-row', 'prior-course', 'prior-track']) {
    assert.equal(await eligible(pool, { tenantId: TENANT, subscriberId: id, courseId: 'co-c-1' }), true, id);
  }
});

test('nothing paid, or only a refund row: not eligible', { skip }, async () => {
  for (const id of ['unpaid', 'refund-only']) {
    assert.equal(await eligible(pool, { tenantId: TENANT, subscriberId: id, courseId: 'co-c-1' }), false, id);
  }
});

test('staff can complete a course for a client who paid before the system, and not for one who did not pay', { skip }, async () => {
  const { completeCourse } = require('../../lib/courseCompletion');
  await pool.query(
    `INSERT INTO enrollments (id, tenant_id, subscriber_id, course_id, status, access_type, enrolled_at) VALUES
       (UUID(), ?, 'prior-course', 'co-c-2', 'active', 'full', NOW()),
       (UUID(), ?, 'unpaid', 'co-c-2', 'active', 'full', NOW())`, [TENANT, TENANT]);
  await pool.query('UPDATE subscribers SET crm_json=? WHERE id=?', [JSON.stringify({ priorPaid: { 'co-c-1': 900, 'co-c-2': 900 } }), 'prior-course']);
  const done = await completeCourse({ tenantId: TENANT, subscriberId: 'prior-course', courseId: 'co-c-2', actor: 'test', requireFullProgress: false });
  assert.ok(done.certificate_code || done.id, 'a completion is issued');
  await assert.rejects(
    completeCourse({ tenantId: TENANT, subscriberId: 'unpaid', courseId: 'co-c-2', actor: 'test', requireFullProgress: false }),
    /Paid tenant enrollment is required/);
});
