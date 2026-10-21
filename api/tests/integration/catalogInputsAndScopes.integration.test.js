'use strict';
/**
 * Against a real MariaDB and the real routers: what the 20 Oct review found
 * accepted that should not have been.
 *
 * - a new course with another course's slug overwrote that course;
 * - a price of -500, a rating of 999 and «abc» for a price were saved or 500'd;
 * - ratings of a course that does not exist answered 200;
 * - a student asking for their staff record got an empty 200;
 * - a branch accountant printed another branch's invoice;
 * - client codes came from one counter shared by every institute.
 *
 * Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-sec-it';
const T2 = 'tenant-sec-it-2';
process.env.DEFAULT_TENANT_ID = T;
process.env.ADMIN_EMAILS = 'owner@sec-it.test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
process.env.DISABLE_BACKGROUND_JOBS = 'true';

const OWNER = { uid: 'u-sec-owner', email: 'owner@sec-it.test' };
const ACCOUNTANT = { uid: 'u-sec-acc', email: 'accountant@sec-it.test' };
const STUDENT = { uid: 'u-sec-student', email: 'student@sec-it.test' };

let pool; let server; let base;
let caller = null;

async function clean() {
  for (const tenant of [T, T2]) {
    for (const table of ['payments', 'subscribers', 'leads', 'staff', 'bundle_courses', 'bundles', 'courses', 'client_code_counter', 'online_price_tiers', 'audit_logs']) {
      await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [tenant]).catch(() => {});
    }
  }
}

async function call(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch { /* html */ }
  return { status: response.status, body: parsed };
}
const as = who => { caller = who; return { post: (p, b) => call('POST', p, b), get: p => call('GET', p) }; };

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  const { branchIdForBranch } = require('../../lib/branches');
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, data_scope, permissions_json)
     VALUES ('sec-acc', ?, 'محاسب الدقي', ?, '01012340000', 'ACCOUNTANT', 1, '2025-01-01', 'branch:DAQQI', ?)`,
    [T, ACCOUNTANT.email, JSON.stringify(['view_financial'])]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, is_active, branch, branch_id, client_code) VALUES ('sec-sub-d', ?, 'عميل الدقي', 1, 'DAQQI', ?, 'C20001')", [T, branchIdForBranch('DAQQI')]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, is_active, branch, branch_id, client_code) VALUES ('sec-sub-t', ?, 'عميل التجمع', 1, 'TAGAMOA', ?, 'C20002')", [T, branchIdForBranch('TAGAMOA')]);
  for (const [id, sub, branch] of [['sec-pay-d', 'sec-sub-d', 'DAQQI'], ['sec-pay-t', 'sec-sub-t', 'TAGAMOA']]) {
    await pool.query(
      `INSERT INTO payments (id, tenant_id, subscriber_id, amount, date, branch, branch_id, status)
       VALUES (?, ?, ?, 100, NOW(), ?, ?, 'paid')`, [id, T, sub, branch, branchIdForBranch(branch)]);
  }

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.tenantId = T;
    if (caller) req.user = { ...caller, tenant_id: T, is_staff: true, mfa_verified: true };
    next();
  });
  app.use(require('../../routes/admin/catalog'));
  app.use(require('../../routes/core/catalog'));
  app.use(require('../../routes/public'));
  app.use(require('../../routes/staff'));
  app.use(require('../../routes/misc/billing'));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!ENABLED) return;
  if (server) await new Promise(resolve => server.close(resolve));
  await clean();
  await pool.end();
  setTimeout(() => process.exit(), 300).unref();
});

const course = (over = {}) => ({
  title: 'كورس الاختبار', instructor: 'محاضر', category: 'GENERAL', type: 'RECORDED',
  price: { EGP: 1500, SAR: 0, USD: 0 }, rating: 4.5, students: 10, ...over,
});

test('a new course with a slug already in use is refused, and the other course is untouched', { skip }, async () => {
  const first = await as(OWNER).post('/api/admin/courses', course({ id: 'sec-course-a', slug: 'sec-slug', title: 'الأصلي' }));
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const second = await as(OWNER).post('/api/admin/courses', course({ slug: 'sec-slug', title: 'المتسلل', price: { EGP: 1 } }));
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'SLUG_TAKEN');
  const [[row]] = await pool.query("SELECT title, price_egp FROM courses WHERE id='sec-course-a' AND tenant_id=?", [T]);
  assert.equal(row.title, 'الأصلي');
  assert.equal(Number(row.price_egp), 1500);
  const [[count]] = await pool.query('SELECT COUNT(*) AS n FROM courses WHERE tenant_id=?', [T]);
  assert.equal(Number(count.n), 1);
  // Saving the same course again under its own slug still works.
  const again = await as(OWNER).post('/api/admin/courses', course({ id: 'sec-course-a', slug: 'sec-slug', title: 'الأصلي ٢' }));
  assert.equal(again.status, 200);
});

test('a negative price, an impossible rating, text for a price and a missing title are 400s', { skip }, async () => {
  const cases = [
    [{ price: { EGP: -500 } }, 'price_egp'],
    [{ rating: 999 }, 'rating'],
    [{ students: -3 }, 'students'],
    [{ price: { EGP: 'abc' } }, 'price_egp'],
    [{ title: '' }, 'title'],
    [{ title: { x: 1 } }, 'title'],
  ];
  for (const [over, field] of cases) {
    const res = await as(OWNER).post('/api/admin/courses', course({ slug: `sec-bad-${field}`, ...over }));
    assert.equal(res.status, 400, `${JSON.stringify(over)} → ${res.status} ${JSON.stringify(res.body)}`);
    assert.equal(res.body.field, field);
    assert.match(res.body.error, /[؀-ۿ]/, 'the message is in Arabic');
  }
  const bundle = await as(OWNER).post('/api/admin/bundles', { title: 'مسار', price_egp: -1, course_ids: [] });
  assert.equal(bundle.status, 400);
  const [[count]] = await pool.query("SELECT COUNT(*) AS n FROM courses WHERE tenant_id=? AND slug LIKE 'sec-bad-%'", [T]);
  assert.equal(Number(count.n), 0);
});

test('ratings of a course that does not exist are a 404', { skip }, async () => {
  assert.equal((await as(null).get('/api/courses/no-such-course/ratings')).status, 404);
  assert.equal((await as(null).get('/api/courses/sec-course-a/ratings')).status, 200);
});

test('a student asking for their staff record is refused, a member of staff is answered', { skip }, async () => {
  const student = await as(STUDENT).get('/api/staff/me');
  assert.equal(student.status, 403);
  assert.equal(student.body.code, 'NOT_STAFF');
  const staff = await as(ACCOUNTANT).get('/api/staff/me');
  assert.equal(staff.status, 200);
  assert.equal(staff.body.email, ACCOUNTANT.email);
});

test('a branch accountant prints their own branch\'s invoice and not another\'s', { skip }, async () => {
  const own = await as(ACCOUNTANT).get('/api/admin/payments/sec-pay-d/invoice-html');
  assert.equal(own.status, 200, JSON.stringify(own.body).slice(0, 200));
  const other = await as(ACCOUNTANT).get('/api/admin/payments/sec-pay-t/invoice-html');
  assert.equal(other.status, 404);
  const owner = await as(OWNER).get('/api/admin/payments/sec-pay-t/invoice-html');
  assert.equal(owner.status, 200);
});

test('client codes are counted per institute, continuing above codes already given', { skip }, async () => {
  const { getNextClientCode } = require('../../lib/mappers');
  const [[shared]] = await pool.query('SELECT next_value FROM client_code_counter WHERE id=1');
  // T has clients already: it continues from the shared counter, so no code repeats.
  const a1 = await getNextClientCode(pool, T);
  const a2 = await getNextClientCode(pool, T);
  assert.equal(Number(a1.slice(1)), Math.max(10001, Number(shared?.next_value || 10001)));
  assert.equal(Number(a2.slice(1)), Number(a1.slice(1)) + 1);
  // T2 has none: it starts at the beginning, and T's codes do not move it.
  assert.equal(await getNextClientCode(pool, T2), 'C10001');
  await getNextClientCode(pool, T);
  assert.equal(await getNextClientCode(pool, T2), 'C10002');
  const [[after]] = await pool.query('SELECT next_value FROM client_code_counter WHERE id=1');
  assert.equal(Number(after?.next_value), Number(shared?.next_value), 'the shared row is no longer drawn from');
});
