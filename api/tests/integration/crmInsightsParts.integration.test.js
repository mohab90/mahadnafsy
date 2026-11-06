'use strict';
/**
 * 6 Nov 2026: GET /api/admin/leads/crm-insights?parts=reminders|ops. «المتابعات» and «الأداء» each asked for the whole answer and threw half away (600 lead rows, about
 * 580 KB, for a screen that draws none of them; or counting every lead for a screen that draws no counts). Against a real MariaDB with a small CRM worked out by hand:
 * each half is exactly what the whole answer holds for it, the half not asked for is empty, an unknown value is the whole answer, and the open load per rep (held for
 * a few seconds) counts the open leads of each rep. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-crm-insights-parts-it';
let pool, server, base;

const clean = async () => { for (const table of ['communications', 'leads', 'staff']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {}); };
async function insights(query = '') {
  const response = await fetch(`${base}/api/admin/leads/crm-insights?idleDays=14${query}`);
  assert.equal(response.status, 200);
  return response.json();
}
const ids = rows => rows.map(row => row.id).sort();
const plain = value => JSON.parse(JSON.stringify(value));

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, permissions_json) VALUES
       ('ci-admin', ?, 'مدير', 'ci-admin@x.t', '01066660001', 'ADMIN', 1, '2025-01-01', '[]'),
       ('ci-r1', ?, 'مندوب ١', 'ci-r1@x.t', '01066660002', 'SALES', 1, '2025-01-01', '[]'),
       ('ci-r2', ?, 'مندوب ٢', 'ci-r2@x.t', '01066660003', 'SALES', 1, '2025-01-01', '[]')`, [T, T, T]);
  const lead = (id, status, rep, followUp, createdDaysAgo) => pool.query(
    `INSERT INTO leads (id, tenant_id, name, source, status, hidden, assigned_sales_id, next_follow_up_date, created_at)
     VALUES (?, ?, ?, 'test', ?, 0, ?, ${followUp ? 'DATE_SUB(NOW(), INTERVAL 1 DAY)' : 'NULL'}, DATE_SUB(NOW(), INTERVAL ? DAY))`, [id, T, `عميل ${id}`, status, rep, createdDaysAgo]);
  await lead('ci-l1', 'contacted', 'ci-r1', true, 20);             // overdue follow-up: a reminder
  await lead('ci-l2', 'new', 'ci-r1', false, 30);                  // new, never contacted, no date: untouched, and quiet for a month
  await lead('ci-l3', 'interested_booking', 'ci-r2', false, 5);    // promised to pay
  await lead('ci-l4', 'converted', 'ci-r2', false, 40);            // closed: not open load
  await lead('ci-l5', 'contacted', 'ci-r2', false, 3);             // open

  const express = require('express');
  const app = express();
  app.use((req, _res, next) => {
    req.tenantId = T;
    req.user = { uid: 'ci-admin', email: 'ci-admin@x.t', name: 'مدير', tenant_id: T, is_staff: true, mfa_verified: true, session_id: 's' };
    next();
  });
  app.use(require('../../routes/admin/leads'));
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

test('the whole answer holds what a hand count says', { skip }, async () => {
  const all = await insights();
  assert.deepEqual(ids(all.reminders), ['ci-l1']);
  assert.deepEqual(ids(all.untouched), ['ci-l2']);
  assert.deepEqual(ids(all.promised), ['ci-l3']);
  assert.deepEqual(all.openLoadByRep, { 'ci-r1': 2, 'ci-r2': 2 }, 'the converted lead is not load');
  assert.ok(ids(all.redistCandidates.map(row => row.lead)).includes('ci-l2'), 'the lead nobody contacted for a month is a candidate');
});

test('each half is what the whole answer holds for it, and the other half is empty', { skip }, async () => {
  const all = await insights();
  const reminders = await insights('&parts=reminders');
  const ops = await insights('&parts=ops');
  for (const key of ['reminders', 'untouched', 'promised', 'remindersCompletionRate']) assert.deepEqual(plain(reminders[key]), plain(all[key]), `reminders half: ${key}`);
  for (const key of ['scorecard', 'redistCandidates', 'openLoadByRep']) assert.deepEqual(plain(ops[key]), plain(all[key]), `ops half: ${key}`);
  assert.deepEqual([reminders.scorecard, reminders.redistCandidates, reminders.openLoadByRep], [[], [], {}], 'the reminders half carries no counts');
  assert.deepEqual([ops.reminders, ops.untouched, ops.promised], [[], [], []], 'the ops half carries no lead rows');
  assert.equal(JSON.stringify(ops).length < JSON.stringify(all).length, true);
});

test('an unknown value is the whole answer', { skip }, async () => {
  const all = await insights();
  assert.deepEqual(plain(await insights('&parts=everything')), plain(all));
});
