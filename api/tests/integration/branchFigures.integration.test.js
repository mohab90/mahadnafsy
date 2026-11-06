'use strict';
/**
 * 6 Nov 2026: GET /api/admin/subscribers/stats?branchFigures=1 gives «اسأل الذكاء» what it counted out of every client and every payment history it had downloaded (up to
 * 50,000 clients): per branch, the clients who joined today and the paid payments recorded today, with what they, this month and all time came to in EGP. Against a real
 * MariaDB with a small ledger worked out by hand: only paid, undeleted payments count; a client with no branch is «other»; and an account whose data scope is one branch
 * is given that branch and no other. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-branch-figures-it';
let pool, server, base, caller;

const accounts = {
  admin: { uid: 'bf-admin', email: 'bf-admin@x.t', name: 'مدير' },
  dokki: { uid: 'bf-dokki', email: 'bf-dokki@x.t', name: 'مدير الدقي' },
};
const clean = async () => { for (const table of ['payments', 'subscribers', 'staff']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {}); };
async function get(url) {
  const response = await fetch(`${base}${url}`);
  const text = await response.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* not json */ }
  return { status: response.status, body };
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, data_scope, permissions_json) VALUES
       ('bf-s1', ?, 'مدير', ?, '01055550001', 'ADMIN', 1, '2025-01-01', 'all', '[]'),
       ('bf-s2', ?, 'مدير الدقي', ?, '01055550002', 'DAQQI_MANAGER', 1, '2025-01-01', 'branch:DAQQI', ?)`,
    [T, accounts.admin.email, T, accounts.dokki.email, JSON.stringify(['view_subscribers'])]);
  // two Dokki clients (one joined today), one Tagamoa client (today), one with no branch (old)
  const sub = (id, branch, createdSql) => pool.query(
    `INSERT INTO subscribers (id, tenant_id, name, is_active, client_code, branch, created_at) VALUES (?, ?, 'عميل', 1, ?, ?, ${createdSql})`, [id, T, id.toUpperCase(), branch]);
  await sub('bf-a', 'DAQQI', 'NOW()');
  await sub('bf-b', 'DAQQI', 'DATE_SUB(NOW(), INTERVAL 60 DAY)');
  await sub('bf-c', 'TAGAMOA', 'NOW()');
  await sub('bf-d', null, 'DATE_SUB(NOW(), INTERVAL 60 DAY)');
  const pay = (id, subscriber, egp, whenSql, { status = 'paid', deleted = false } = {}) => pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, amount, currency, amount_egp, date, status, payment_type, deleted_at)
     VALUES (?, ?, ?, ?, 'EGP', ?, ${whenSql}, ?, 'COURSE', ${deleted ? 'NOW()' : 'NULL'})`, [id, T, subscriber, egp, egp, status]);
  await pay('bf-p1', 'bf-a', 1000, 'NOW()');                                   // Dokki, today
  await pay('bf-p2', 'bf-b', 400, 'DATE_SUB(NOW(), INTERVAL 40 DAY)');         // Dokki, long ago
  await pay('bf-p3', 'bf-c', 250, 'NOW()');                                    // Tagamoa, today
  await pay('bf-p4', 'bf-d', 90, 'DATE_SUB(NOW(), INTERVAL 40 DAY)');          // no branch, long ago
  await pay('bf-p5', 'bf-a', 700, 'NOW()', { status: 'pending' });             // not paid
  await pay('bf-p6', 'bf-a', 600, 'NOW()', { deleted: true });                 // taken back

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.tenantId = T;
    if (caller) req.user = { ...caller, tenant_id: T, is_staff: true, mfa_verified: true, session_id: 's' };
    next();
  });
  app.use(require('../../routes/admin/stafflists'));
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

test('per branch: who joined today, today\'s paid payments, and the EGP today, this month and all time', { skip }, async () => {
  caller = accounts.admin;
  const answer = await get('/api/admin/subscribers/stats?branchFigures=1');
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  const figures = answer.body.branchFigures;
  assert.deepEqual(figures.DAQQI, { todayNew: 1, todayPayments: 1, todayRevenueEgp: 1000, monthRevenueEgp: 1000, revenueEgp: 1400 }, 'the pending and the taken-back ones are not in it');
  assert.deepEqual(figures.TAGAMOA, { todayNew: 1, todayPayments: 1, todayRevenueEgp: 250, monthRevenueEgp: 250, revenueEgp: 250 });
  assert.deepEqual(figures.other, { todayNew: 0, todayPayments: 0, todayRevenueEgp: 0, monthRevenueEgp: 0, revenueEgp: 90 }, 'a client with no branch is «other»');
  assert.equal(answer.body.total, 4);
  assert.equal('branchFigures' in (await get('/api/admin/subscribers/stats')).body, false, 'only when asked for');
});

test('an account whose data scope is one branch is given that branch\'s figures and no other', { skip }, async () => {
  caller = accounts.dokki;
  const answer = await get('/api/admin/subscribers/stats?branchFigures=1');
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  assert.deepEqual(Object.keys(answer.body.branchFigures).sort(), ['DAQQI']);
  assert.equal(answer.body.branchFigures.DAQQI.revenueEgp, 1400);
});
