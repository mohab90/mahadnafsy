'use strict';
/**
 * Totals come from the database, not from a list that can be cut. On a real MariaDB: GET /api/admin/payments/summary equals the sum of EVERY row the payments list would return
 * (read in pages past its 5,000 cap) — per status group, per currency, certificate money apart from course money, deleted rows out — under each filter the list takes; and the
 * expenses screen's totals (GET /api/admin/expenses/page: filteredTotals, byCategory) equal the sum of every row of GET /api/admin/expenses, which itself stops at 5,000 and says so.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-finance-summary-it';
let pool; let payments; let expenses;

const ACCOUNTANT = { id: 'st-sm-acc', name: 'محاسب', role: 'accountant', permissions_json: '["view_financial","manage_financial"]' };

async function call(router, route, query = {}) {
  const layer = router.stack.find(item => item.route?.path === route && item.route.methods.get);
  assert.ok(layer, route);
  const res = { statusCode: 200, body: null, headers: {}, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; }, setHeader(name, value) { this.headers[name] = value; } };
  const req = { params: {}, body: {}, query, headers: {}, tenantId: T, user: { uid: 'u', email: 'acc-sm@example.test', tenant_id: T }, staffRecord: ACCOUNTANT, isSuperAdmin: false, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res;
}

/** Every row the payments list matches, read in pages until it runs out (the list itself stops at 5,000 a page). */
async function fullPaymentList(query) {
  const all = [];
  for (;;) {
    const page = (await call(payments, '/api/admin/payments', { ...query, limit: '5000', offset: String(all.length) })).body;
    all.push(...page);
    if (page.length < 5000) return all;
  }
}

/** What a screen would have added up from those rows, with the summary's own definitions. */
function sumRows(rows) {
  const out = { paid: null, refunded: null, uncollected: null };
  for (const key of Object.keys(out)) out[key] = { count: 0, totalEgp: 0, courseEgp: 0, certificateEgp: 0, byCurrency: {} };
  for (const row of rows) {
    const group = out[row.status === 'paid' ? 'paid' : row.status === 'refunded' ? 'refunded' : 'uncollected'];
    group.count += 1;
    group.totalEgp += row.amountEgp;
    if (row.paymentType === 'certificate') group.certificateEgp += row.amountEgp; else group.courseEgp += row.amountEgp;
    group.byCurrency[row.currency] = (group.byCurrency[row.currency] || 0) + row.amount;
  }
  for (const group of Object.values(out)) {
    for (const key of ['totalEgp', 'courseEgp', 'certificateEgp']) group[key] = Math.round(group[key] * 100) / 100;
    for (const cur of Object.keys(group.byCurrency)) group.byCurrency[cur] = Math.round(group.byCurrency[cur] * 100) / 100;
  }
  return out;
}
const strip = groups => Object.fromEntries(Object.entries(groups).map(([key, { unconverted, ...rest }]) => [key, rest]));

let seq = 0;
const payment = (amount, currency, egp, { status = 'paid', type = 'COURSE', source = 'staff', method = 'كاش', deleted = false, date = '2026-10-10 10:00:00' } = {}) => pool.query(
  `INSERT INTO payments (id, tenant_id, subscriber_id, amount, currency, amount_egp, status, payment_type, payment_method, source, date, branch_id, created_at, deleted_at)
   VALUES (?, ?, 'sub-sm-1', ?, ?, ?, ?, ?, ?, ?, ?, 'branch-online-egypt', ?, ?)`,
  [`sm-p-${++seq}`, T, amount, currency, egp, status, type, method, source, date, date, deleted ? new Date() : null]);

async function clean() {
  for (const table of ['payments', 'expenses', 'subscribers', 'staff']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  payments = require('../../routes/payments');
  expenses = require('../../routes/admin-operations');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, branch, branch_id) VALUES ('sub-sm-1', ?, 'عميل', '1019400010', 'ONLINE_EGYPT', 'branch-online-egypt')", [T]);
  // Paymob (card) payments in every state, two currencies, a certificate, and rows that are not money
  await payment(1000, 'EGP', 1000, { source: 'paymob', method: 'paymob' });
  await payment(400, 'SAR', 4000, { source: 'paymob', method: 'paymob' });
  await payment(50, 'USD', 2500, { source: 'paymob', method: 'paymob' });
  await payment(300, 'EGP', 300, { source: 'paymob', method: 'paymob', type: 'CERTIFICATE' });
  await payment(700, 'EGP', 700, { source: 'paymob', method: 'paymob', status: 'pending' });
  await payment(60, 'EGP', 60, { source: 'paymob', method: 'paymob', status: 'failed' });
  await payment(200, 'EGP', 200, { source: 'paymob', method: 'paymob', status: 'refunded' });
  await payment(999, 'EGP', 999, { source: 'paymob', method: 'paymob', deleted: true });
  await payment(500, 'EGP', 500, { source: 'paymob', method: 'paymob', date: '2026-09-01 10:00:00' });
  // hand-entered money, which a Paymob screen must not add
  await payment(2000, 'EGP', 2000, { source: 'staff', method: 'كاش' });
  await payment(80, 'SAR', 800, { source: 'staff', method: 'تحويل بنكي', type: 'CERTIFICATE' });
  // past the list's cap: 5,010 one-pound Paymob payments in a single statement
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, amount, currency, amount_egp, status, payment_type, payment_method, source, date, branch_id, created_at)
     SELECT CONCAT('sm-bulk-', seq), ?, 'sub-sm-1', 1, 'EGP', 1, 'paid', 'COURSE', 'paymob', 'paymob', '2026-10-12 10:00:00', 'branch-online-egypt', '2026-10-12 10:00:00' FROM seq_1_to_5010`, [T]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

for (const [name, query] of [
  ['no filter', {}],
  ['source=paymob', { source: 'paymob' }],
  ['source=paymob in October', { source: 'paymob', startDate: '2026-10-01', endDate: '2026-10-31' }],
  ['certificates only', { paymentType: 'CERTIFICATE' }],
  ['status=paid', { status: 'paid' }],
  ['status=pending', { status: 'pending' }],
  ['channel=كاش', { channel: 'كاش' }],
]) {
  test(`the payments summary equals the sum of every row of the list — ${name}`, { skip }, async () => {
    const rows = await fullPaymentList(query);
    const summary = (await call(payments, '/api/admin/payments/summary', query)).body;
    assert.deepEqual(strip(summary.groups), sumRows(rows));
  });
}

test('past the list\'s cap the list is cut and the summary is not: the capped list cannot give the total', { skip }, async () => {
  const query = { source: 'paymob' };
  const cut = (await call(payments, '/api/admin/payments', query.limit ? query : { ...query, limit: '5000' })).body;
  assert.equal(cut.length, 5000, 'the list stops at its cap');
  const summary = (await call(payments, '/api/admin/payments/summary', query)).body;
  const everything = sumRows(await fullPaymentList(query));
  assert.notEqual(sumRows(cut).paid.count, summary.groups.paid.count, 'a sum of the capped rows is a different figure');
  assert.equal(summary.groups.paid.count, everything.paid.count);
  assert.ok(summary.groups.paid.count > 5000);
});

test('the summary keeps the groups, certificate money and the deleted rows where the screen has them', { skip }, async () => {
  const { groups } = (await call(payments, '/api/admin/payments/summary', { source: 'paymob', startDate: '2026-10-01', endDate: '2026-10-11' })).body;
  assert.equal(groups.paid.count, 4, 'EGP 1000, SAR 400, USD 50 and the certificate; the 999 deleted one is not money');
  assert.equal(groups.paid.totalEgp, 1000 + 4000 + 2500 + 300);
  assert.equal(groups.paid.certificateEgp, 300, 'certificate money apart');
  assert.equal(groups.paid.courseEgp, 1000 + 4000 + 2500);
  assert.deepEqual(groups.paid.byCurrency, { EGP: 1300, SAR: 400, USD: 50 });
  assert.deepEqual([groups.refunded.count, groups.refunded.totalEgp], [1, 200]);
  assert.deepEqual([groups.uncollected.count, groups.uncollected.totalEgp], [2, 760], 'pending and failed are never added to the collected');
});

test('a foreign payment with no stored pound value is counted apart, not added as pounds', { skip }, async () => {
  await pool.query("INSERT INTO payments (id, tenant_id, subscriber_id, amount, currency, amount_egp, status, payment_type, payment_method, source, date, branch_id, created_at) VALUES ('sm-p-x1', ?, 'sub-sm-1', 300, 'SAR', NULL, 'paid', 'COURSE', 'x', 'unit', '2026-10-05 10:00:00', 'branch-online-egypt', '2026-10-05 10:00:00')", [T]);
  await pool.query("INSERT INTO payments (id, tenant_id, subscriber_id, amount, currency, amount_egp, status, payment_type, payment_method, source, date, branch_id, created_at) VALUES ('sm-p-x2', ?, 'sub-sm-1', 70, 'EGP', NULL, 'paid', 'COURSE', 'x', 'unit', '2026-10-05 10:00:00', 'branch-online-egypt', '2026-10-05 10:00:00')", [T]);
  const { groups } = (await call(payments, '/api/admin/payments/summary', { source: 'unit' })).body;
  assert.equal(groups.paid.totalEgp, 70, 'the pound payment at its amount, the riyals not at all');
  assert.equal(groups.paid.unconverted, 1);
  assert.deepEqual(groups.paid.byCurrency, { EGP: 70, SAR: 300 });
});

const expense = (amount, currency, category, date, deleted = false) => pool.query(
  `INSERT INTO expenses (id, tenant_id, description, amount, currency, amount_egp, category, date, created_at, deleted_at) VALUES (?, ?, 'مصروف', ?, ?, ?, ?, ?, ?, ?)`,
  [`sm-e-${++seq}`, T, amount, currency, amount, category, date, date, deleted ? new Date() : null]);

test('the expenses screen\'s totals equal the sum of every row of the list, which itself stops at 5,000 and says so', { skip }, async () => {
  await expense(100, 'EGP', 'RENT', '2026-10-02 10:00:00');
  await expense(40, 'SAR', 'RENT', '2026-10-03 10:00:00');
  await expense(25, 'USD', 'OTHER', '2026-10-04 10:00:00');
  await expense(555, 'EGP', 'OTHER', '2026-10-05 10:00:00', true);
  await expense(70, 'EGP', 'OTHER', '2026-09-01 10:00:00');
  await pool.query(
    `INSERT INTO expenses (id, tenant_id, description, amount, currency, amount_egp, category, date, created_at)
     SELECT CONCAT('sm-ebulk-', seq), ?, 'مصروف', 1, 'EGP', 1, 'OTHER', '2026-10-20 10:00:00', '2026-10-20 10:00:00' FROM seq_1_to_5005`, [T]);

  const list = await call(expenses, '/api/admin/expenses', {});
  assert.equal(list.body.length, 5000);
  assert.equal(list.headers['X-Truncated'], 'true', 'the list says it was cut');

  const perCurrency = rows => rows.reduce((out, row) => ({ ...out, [row.currency]: (out[row.currency] || 0) + row.amount }), {});
  // Every row, read through the page route without its cap, is what the totals must equal.
  const everyRow = [];
  for (;;) {
    const page = (await call(expenses, '/api/admin/expenses/page', { limit: '500', offset: String(everyRow.length) })).body;
    everyRow.push(...page.rows);
    if (!page.rows.length || everyRow.length >= page.total) break;
  }
  const whole = (await call(expenses, '/api/admin/expenses/page', { limit: '1' })).body;
  assert.equal(whole.total, 5005 + 4, 'every live expense (the 5,005 bulk ones and four typed), the deleted one out');
  assert.deepEqual(Object.fromEntries(whole.filteredTotals.map(row => [row.currency, row.amount])), perCurrency(everyRow));
  assert.ok(perCurrency(list.body).EGP < perCurrency(everyRow).EGP, 'the capped list under-counts');

  const october = (await call(expenses, '/api/admin/expenses/page', { limit: '500', from: '2026-10-01', to: '2026-10-10', category: 'all' })).body;
  assert.deepEqual(Object.fromEntries(october.filteredTotals.map(row => [row.currency, row.amount])), { EGP: 100, SAR: 40, USD: 25 });
});
