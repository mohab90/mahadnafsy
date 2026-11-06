'use strict';
/**
 * 6 Nov 2026: GET /api/admin/expenses/page gives the expenses screen a page at a time and the figures the screen used to add up from the whole download. Against a real
 * MariaDB, with the list route (which sends everything) as the reference: the pages put together are exactly the list filtered the same way, the count and the per-currency
 * totals of the filter are the sums of those rows, the category totals are the sums of the whole scope, a deleted expense is in none of them, a branch asks for its own,
 * and an account without view_financial is refused. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-expenses-page-it';
let pool, server, base, caller;

const accounts = {
  full: { uid: 'ep-full', email: 'ep-full@x.t', name: 'مدير' },
  marketer: { uid: 'ep-mk', email: 'ep-mk@x.t', name: 'تسويق' },
};
const clean = async () => { for (const table of ['expenses', 'staff']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {}); };
async function get(url) {
  const response = await fetch(`${base}${url}`);
  const text = await response.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* not json */ }
  return { status: response.status, body };
}
const plain = value => JSON.parse(JSON.stringify(value));
const sumBy = (rows, key) => rows.reduce((acc, row) => { acc[row[key]] = Math.round(((acc[row[key]] || 0) + Number(row.amount)) * 100) / 100; return acc; }, {});
const asMap = list => Object.fromEntries(list.map(({ currency, amount }) => [currency, Math.round(amount * 100) / 100]));

async function allPages(query) {
  const rows = [];
  let answer;
  do {
    answer = (await get(`/api/admin/expenses/page?limit=7&offset=${rows.length}${query}`)).body;
    rows.push(...answer.rows);
  } while (rows.length < answer.total && answer.rows.length > 0);
  return { rows, answer };
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, permissions_json) VALUES
       ('ep-s1', ?, 'مدير', ?, '01022220001', 'ADMIN', 1, '2025-01-01', ?),
       ('ep-s2', ?, 'تسويق', ?, '01022220002', 'SUPPORT', 1, '2025-01-01', ?)`,
    [T, accounts.full.email, JSON.stringify([]), T, accounts.marketer.email, JSON.stringify(['view_courses'])]);
  const categories = ['RENT', 'SALARIES', 'OTHER', 'MARKETING'];
  const branches = ['branch-daqqi', 'branch-tagamoa', 'branch-online-egypt'];
  for (let i = 0; i < 31; i++) {
    const day = String((i % 28) + 1).padStart(2, '0');
    await pool.query(
      `INSERT INTO expenses (id, tenant_id, branch_id, date, description, amount, currency, category, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [`ep-e${i}`, T, branches[i % 3], `2026-${i < 16 ? '09' : '10'}-${day} 10:00:00`, `مصروف ${i}`, 100 + i * 7.25, i % 5 === 0 ? 'SAR' : 'EGP', categories[i % 4]]);
  }
  await pool.query("UPDATE expenses SET deleted_at=NOW() WHERE id IN ('ep-e3','ep-e4') AND tenant_id=?", [T]);

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.tenantId = T;
    if (caller) req.user = { ...caller, tenant_id: T, is_staff: true, mfa_verified: true, session_id: 's' };
    next();
  });
  app.use(require('../../routes/admin-operations'));
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

test('pages put together are the list, with the count and the totals of the whole scope', { skip }, async () => {
  caller = accounts.full;
  const list = (await get('/api/admin/expenses')).body;
  assert.equal(list.length, 29, 'the two deleted ones are not in it');
  const { rows, answer } = await allPages('');
  assert.deepEqual(plain(rows), plain(list), 'same rows, same order, same shape');
  assert.equal(answer.total, 29);
  assert.deepEqual(asMap(answer.filteredTotals), sumBy(list, 'currency'));
  const expectedByCategory = {};
  for (const row of list) expectedByCategory[`${row.category}|${row.currency}`] = Math.round(((expectedByCategory[`${row.category}|${row.currency}`] || 0) + row.amount) * 100) / 100;
  const gotByCategory = Object.fromEntries(answer.byCategory.map(item => [`${item.category}|${item.currency}`, Math.round(item.amount * 100) / 100]));
  assert.deepEqual(gotByCategory, expectedByCategory);
});

test('a category and a date range narrow the rows, the count and the totals alike, and the category cards stay whole', { skip }, async () => {
  caller = accounts.full;
  const list = (await get('/api/admin/expenses')).body;
  const rentLabel = list.find(row => row.categoryCode === 'RENT').category;
  const narrowed = list.filter(row => row.category === rentLabel && row.date >= '2026-09-02' && row.date <= '2026-10-20');
  assert.ok(narrowed.length > 2 && narrowed.length < list.length);
  const { rows, answer } = await allPages(`&category=${encodeURIComponent(rentLabel)}&from=2026-09-02&to=2026-10-20`);
  assert.deepEqual(plain(rows), plain(narrowed));
  assert.equal(answer.total, narrowed.length);
  assert.deepEqual(asMap(answer.filteredTotals), sumBy(narrowed, 'currency'));
  assert.equal(answer.byCategory.reduce((sum, item) => sum + item.amount, 0) > answer.filteredTotals.reduce((sum, item) => sum + item.amount, 0), true, 'the cards are of the whole scope');
  const past = (await get('/api/admin/expenses/page?offset=500')).body;
  assert.deepEqual([past.rows.length, past.total], [0, 29], 'a page past the end is empty, the count is still the count');
});

test('a branch asks for its own expenses and nobody else\'s', { skip }, async () => {
  caller = accounts.full;
  const list = (await get('/api/admin/expenses?branch=DAQQI')).body;
  assert.ok(list.length > 0 && list.every(row => row.branchType === 'DAQQI'));
  const { rows, answer } = await allPages('&branch=DAQQI');
  assert.deepEqual(plain(rows), plain(list));
  assert.deepEqual(asMap(answer.filteredTotals), sumBy(list, 'currency'));
  assert.equal((await get('/api/admin/expenses/page?branch=NOWHERE')).status, 400);
});

test('an account without view_financial is refused', { skip }, async () => {
  caller = accounts.marketer;
  assert.equal((await get('/api/admin/expenses/page')).status, 403);
  caller = null;
  assert.equal((await get('/api/admin/expenses/page')).status, 401);
});
