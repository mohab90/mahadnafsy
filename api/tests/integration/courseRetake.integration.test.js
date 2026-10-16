'use strict';
/**
 * «إعادة» on a real MariaDB (14 Oct 2026): a course taken before, taken again at 50% off — the
 * price from the catalogue, added to what the client agreed, refused for a course not taken,
 * one still owing, or an amount above the retake price.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-retake-it';
let pool; let planRetake;

const clean = async () => {
  for (const table of ['payments', 'enrollments', 'subscribers', 'courses']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
};
const pay = (id, amount, expected, status = 'paid') => pool.query(
  `INSERT INTO payments (id, tenant_id, subscriber_id, course_id, date, payment_no, amount, currency, amount_egp, payment_type, payment_method, status, course_expected, is_installment)
   VALUES (?, ?, 'sub-rt-1', 'c-rt-1', NOW(), ?, ?, 'EGP', ?, 'COURSE', 'كاش', ?, ?, 0)`, [id, TENANT, 770000 + Math.floor(Math.random() * 9000), amount, amount, status, expected]);

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  ({ planRetake } = require('../../lib/courseRetake'));
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [TENANT, TENANT]);
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp, price_sar, price_usd,
                          orig_price_egp, orig_price_sar, orig_price_usd, rating, students, duration, level, sort_order)
     VALUES ('c-rt-1', ?, 'دبلومة', 'd', 's', 'x', 't', 'GENERAL', 'RECORDED', 3000, 0, 0, 0, 0, 0, 0, 0, '', '', 0)`, [TENANT]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone) VALUES ('sub-rt-1', ?, 'عميل إعادة', '1017000001')", [TENANT]);
});
after(async () => { if (!ENABLED) return; await clean(); await pool.end(); });

const plan = amount => planRetake(pool, { tenantId: TENANT, subscriberId: 'sub-rt-1', courseId: 'c-rt-1', currency: 'EGP', amount });

test('a course the client never took is not retaken', { skip }, async () => {
  const answer = await plan(1500);
  assert.equal(answer.ok, false);
  assert.equal(answer.code, 'RETAKE_NOT_TAKEN');
});

test('a course still owing is not retaken until it is paid up', { skip }, async () => {
  await pay('pay-rt-1', 1000, 3000);
  const answer = await plan(1500);
  assert.equal(answer.code, 'RETAKE_PREVIOUS_UNPAID');
  assert.match(answer.error, /2,000/);
});

test('paid up, the retake is half the catalogue price, added to what the client agreed', { skip }, async () => {
  await pay('pay-rt-2', 2000, 3000);
  const answer = await plan(1500);
  assert.equal(answer.ok, true, JSON.stringify(answer));
  assert.equal(answer.half, 1500);
  assert.equal(answer.expected, 4500, 'the 3,000 agreed, and the 1,500 retake on top');
  assert.match(answer.note, /إعادة كورس بخصم 50%/);
});

test('an amount above the retake price is refused, and so is a course with no price', { skip }, async () => {
  assert.equal((await plan(1600)).code, 'RETAKE_AMOUNT_TOO_HIGH');
  assert.equal((await planRetake(pool, { tenantId: TENANT, subscriberId: 'sub-rt-1', courseId: 'c-rt-1', currency: 'SAR', amount: 10 })).code, 'RETAKE_NO_PRICE');
});

test('no client or no course is asked for, not guessed', { skip }, async () => {
  assert.equal((await planRetake(pool, { tenantId: TENANT, subscriberId: '', courseId: 'c-rt-1', amount: 1 })).code, 'RETAKE_NEEDS_COURSE');
});
