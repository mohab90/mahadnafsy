'use strict';
/**
 * 6 Nov 2026: GET /api/admin/finance/revenue-breakdown is what the accounts overview draws — revenue by type, by course, by month and by box — summed by the database
 * from the paid payments' own amount_egp, instead of added up in the browser from the 500 newest orders and a download of up to 50,000 payments. Against a real MariaDB with
 * a small ledger whose answer is worked out by hand: only paid, undeleted payments count; online (Paymob) is told apart from the desk; the box split merges names as the
 * payments register does and agrees with it; an account without view_financial / view_orders is refused. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-revenue-breakdown-it';
let pool, server, base, caller;

const accounts = {
  admin: { uid: 'rb-admin', email: 'rb-admin@x.t', name: 'مدير' },
  limited: { uid: 'rb-lim', email: 'rb-lim@x.t', name: 'محدود' },
};
const clean = async () => { for (const table of ['payments', 'subscribers', 'courses', 'staff']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {}); };
async function get(url) {
  const response = await fetch(`${base}${url}`);
  const text = await response.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* not json */ }
  return { status: response.status, body };
}
const stamp = (monthsBack, day) => {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, day, 12, 0, 0));
  return { sql: date.toISOString().slice(0, 19).replace('T', ' '), month: date.toISOString().slice(0, 7) };
};

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, permissions_json) VALUES
       ('rb-s1', ?, 'مدير', ?, '01044440001', 'ADMIN', 1, '2025-01-01', '[]'),
       ('rb-s2', ?, 'محدود', ?, '01044440002', 'OTHER', 1, '2025-01-01', ?)`,
    [T, accounts.admin.email, T, accounts.limited.email, JSON.stringify(['view_leads'])]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, is_active, client_code) VALUES ('rb-sub', ?, 'عميل', 1, 'RB1')", [T]);
  await pool.query(
    `INSERT INTO courses (id, tenant_id, slug, title, description, short_description, instructor, thumbnail, category, type, price_egp, is_published)
     VALUES ('rb-c1', ?, 'rb-c1-it', 'الكورس الأول', '', '', '', '', 'GENERAL', 'RECORDED', 1000, 1), ('rb-c2', ?, 'rb-c2-it', 'الكورس الثاني', '', '', '', '', 'GENERAL', 'RECORDED', 1000, 1)`, [T, T]);
  const pay = (id, type, course, method, egp, when, { status = 'paid', deleted = false, source = null } = {}) => pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, currency, amount_egp, date, status, payment_type, payment_method, source, deleted_at)
     VALUES (?, ?, 'rb-sub', ?, ?, 'EGP', ?, ?, ?, ?, ?, ?, ${deleted ? 'NOW()' : 'NULL'})`, [id, T, course, egp, egp, when.sql, status, type, method, source]);
  const now1 = stamp(0, 5); const now2 = stamp(0, 6); const before1 = stamp(1, 10);
  await pay('rb-p1', 'COURSE', 'rb-c1', 'cash', 1000, now1);
  await pay('rb-p2', 'COURSE', 'rb-c1', 'paymob', 500, now1, { source: 'paymob' });
  await pay('rb-p3', 'COURSE', 'rb-c2', 'instapay', 300, before1);
  await pay('rb-p4', 'CERTIFICATE', null, 'cash', 200, now2);
  await pay('rb-p5', 'BUNDLE', null, 'cash', 400, before1);
  await pay('rb-p6', 'COURSE', 'rb-c1', 'cash', 999, now1, { status: 'pending' });
  await pay('rb-p7', 'COURSE', 'rb-c1', 'cash', 777, now1, { deleted: true });
  await pay('rb-p8', null, null, 'cash', 50, now2);

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.tenantId = T;
    if (caller) req.user = { ...caller, tenant_id: T, is_staff: true, mfa_verified: true, session_id: 's' };
    next();
  });
  app.use(require('../../routes/finance-payments-register'));
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

test('by type, by course and by month are the paid, undeleted payments\' own EGP, worked out by hand', { skip }, async () => {
  caller = accounts.admin;
  const answer = await get('/api/admin/finance/revenue-breakdown');
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  const out = answer.body;
  assert.deepEqual(out.byType, { course: 1800, bundle: 400, certificate: 200, consultation: 0, book: 0, carneh: 0, other: 50 }, 'the pending and the taken-back payments are not in it');
  assert.deepEqual(out.byCourse.map(row => [row.id, row.title, row.total, row.online, row.manual]), [
    ['rb-c1', 'الكورس الأول', 1500, 500, 1000],
    ['rb-c2', 'الكورس الثاني', 300, 0, 300],
  ]);
  assert.equal(out.monthly.length, 12);
  const [thisMonth, lastMonth] = [out.monthly[11], out.monthly[10]];
  assert.deepEqual([thisMonth.online, thisMonth.manual], [500, 1250]);
  assert.deepEqual([lastMonth.online, lastMonth.manual], [0, 700]);
  assert.equal(out.monthly.slice(0, 10).every(row => row.online === 0 && row.manual === 0), true);
  assert.equal(out.monthly[11].month, new Date().toISOString().slice(0, 7));
});

test('the month\'s boxes: the desk\'s money by merged channel, the online money apart, and they agree with the payments register', { skip }, async () => {
  caller = accounts.admin;
  const { canonicalChannel } = require('../../lib/paymentChannels');
  const thisMonth = stamp(0, 1).month;
  const out = (await get(`/api/admin/finance/revenue-breakdown?month=${thisMonth}`)).body;
  assert.equal(out.online, 500);
  assert.deepEqual(out.channels, { [canonicalChannel('cash')]: 1250 });
  const register = (await get(`/api/admin/finance/payments-register?from=${thisMonth}-01&to=${thisMonth}-28&pageSize=1`)).body;
  assert.equal(register.totalEgp, 1750, 'the register\'s total for the same days');
  assert.equal(out.online + Object.values(out.channels).reduce((sum, value) => sum + value, 0), register.totalEgp);
  const last = stamp(1, 1).month;
  const lastOut = (await get(`/api/admin/finance/revenue-breakdown?month=${last}`)).body;
  assert.equal(lastOut.online, 0);
  assert.equal(Object.values(lastOut.channels).reduce((sum, value) => sum + value, 0), 700);
});

test('an account that may see neither the books nor the orders is refused', { skip }, async () => {
  caller = accounts.limited;
  assert.equal((await get('/api/admin/finance/revenue-breakdown')).status, 403);
  caller = null;
  assert.equal((await get('/api/admin/finance/revenue-breakdown')).status, 401);
});
