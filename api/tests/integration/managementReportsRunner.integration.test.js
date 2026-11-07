'use strict';
/**
 * «تقارير الإدارة» in six groups (GET /api/admin/reports/catalog and /run/:key, api/lib/reportRunner.js) over HTTP on the real app and a real MariaDB: every report has a
 * group and a one-line description; the new ones add up to a ledger small enough to do by hand; the old figures come out of the management report unchanged; and the
 * reports are the owner's (admin 200, sales 403, signed out 401, an unknown key 404). March 2026 unless said.
 *
 *   activity   P: five actions in three different hours over two days → 3 active hours, 2 active days, 1.7 an hour;  Q: one action
 *   cohorts    February: 3 clients, one pays in February, one in March, the first again in April, a certificate does not count → 33 / 33 / 33 / 0
 *              March: 2 clients, one pays in March → 50 / 0 / 0 / 0
 *   ageing     on 31 March unpaid: 2 days late ×1, 11 days ×2, 58 days ×1, 150 days ×1 (a paid one and a future one do not count) → 1 / 2 / 1 / 1, four clients
 *   branches   ONLINE_EGYPT in March: leads 2 (one converted), new clients 2, revenue 1000, expenses 200, net 800
 *   income     March course money: 700 + 1000 in two payments
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
const skip = !ENABLED && 'no DB_* configured';
const { startApp, signInStaff, ensureTenant } = require('./support/http');

// The reports are one of the routes still held to the original institute (middleware/legacyTenantContainment.js), so the ledger is its own, in the file's throwaway database.
const T = 'tenant-default';
const OTHER = 'tenant-report-run-it-other';
const RANGE = 'from=2026-03-01&to=2026-03-31';
let pool; let app; let admin; let sales;

const at = (stamp) => new Date(`${stamp.replace(' ', 'T')}:00Z`);
let seq = 0;
const log = (actor, stamp) => pool.query(
  "INSERT INTO activity_logs (id, tenant_id, action, entity, label, actor, actor_name, department, details, at) VALUES (?, ?, 'update', 'leads', 'x', ?, ?, '', '', ?)",
  [`al-rr-${++seq}`, T, actor, actor, at(stamp)]);
const subscriber = (id, created, tenant = T) => pool.query(
  "INSERT INTO subscribers (id, tenant_id, name, phone, branch, created_at) VALUES (?, ?, ?, ?, 'ONLINE_EGYPT', ?)", [id, tenant, id, `1017${String(++seq).padStart(7, '0')}`, at(created)]);
const payment = (subscriberId, stamp, amount, extra = {}) => pool.query(
  `INSERT INTO payments (id, tenant_id, subscriber_id, date, amount, currency, fx_rate_to_egp, amount_egp, payment_type, course_id, status, branch, payment_method, is_installment)
   VALUES (?, ?, ?, ?, ?, 'EGP', 1, ?, ?, 'co-rr-1', 'paid', 'ONLINE_EGYPT', 'كاش', 0)`, [`pay-rr-${++seq}`, extra.tenant || T, subscriberId, at(stamp), amount, amount, extra.type || 'COURSE']);
const entry = (due, paid, subscriberId) => pool.query(
  'INSERT INTO installment_entries (id, plan_id, tenant_id, seq, due_date, amount, paid, subscriber_id) VALUES (?, ?, ?, 0, ?, 100, ?, ?)', [`ie-rr-${++seq}`, `plan-rr-${seq}`, T, due, paid, subscriberId]);
const lead = (stamp, status = 'new') => pool.query(
  "INSERT INTO leads (id, tenant_id, name, phone, source, status, hidden, branch, created_at) VALUES (?, ?, 'ليد', ?, 'فيسبوك', ?, 0, 'ONLINE_EGYPT', ?)", [`ld-rr-${++seq}`, T, `0107${String(seq).padStart(7, '0')}`, status, at(stamp)]);
const run = (session, key, query = RANGE) => app.call('GET', `/api/admin/reports/run/${key}?${query}`, { session });

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await ensureTenant(pool, T);
  await ensureTenant(pool, OTHER);
  app = await startApp(pool);
  admin = await signInStaff(pool, app, { tenantId: T, id: 'st-rr-admin', role: 'ADMIN', name: 'المدير' });
  sales = await signInStaff(pool, app, { tenantId: T, id: 'st-rr-sales', role: 'SALES', name: 'رنا' });
  await pool.query("INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES ('st-rr-p', ?, 'بيتر', 'p@rr.test', '1011111101', 'SALES', 1, '2025-01-01'), ('st-rr-q', ?, 'كريم', 'q@rr.test', '1011111102', 'SALES', 1, '2025-01-01')", [T, T]);
  await pool.query("INSERT INTO courses (id, tenant_id, slug, title, description, short_description, instructor, thumbnail, category, type) VALUES ('co-rr-1', ?, 'co-rr-1', 'دورة', '', '', '', '', 'GENERAL', 'RECORDED')", [T]);
  await pool.query("INSERT INTO branches (id, tenant_id, branch_key, slug, label) VALUES ('br-rr-1', ?, 'ONLINE_EGYPT', 'online-egypt-rr', 'أونلاين مصر')", [T]);

  for (const stamp of ['2026-03-10 09:05', '2026-03-10 09:40', '2026-03-10 09:55', '2026-03-10 11:00', '2026-03-11 09:00']) await log('p@rr.test', stamp);
  await log('q@rr.test', '2026-03-12 10:00');
  await log('p@rr.test', '2026-02-12 10:00'); // outside the range

  for (const [id, created] of [['sub-rr-1', '2026-02-05 10:00'], ['sub-rr-2', '2026-02-06 10:00'], ['sub-rr-3', '2026-02-07 10:00'], ['sub-rr-4', '2026-03-02 10:00'], ['sub-rr-5', '2026-03-03 10:00']]) await subscriber(id, created);
  await subscriber('sub-rr-x', '2026-02-05 10:00', OTHER);
  await payment('sub-rr-1', '2026-02-20 10:00', 500); await payment('sub-rr-2', '2026-03-10 10:00', 700); await payment('sub-rr-1', '2026-04-05 10:00', 300);
  await payment('sub-rr-3', '2026-02-25 10:00', 150, { type: 'CERTIFICATE' }); await payment('sub-rr-4', '2026-03-15 10:00', 1000);
  await payment('sub-rr-x', '2026-03-15 10:00', 9999, { tenant: OTHER });

  await entry('2026-03-29', 0, 'a'); await entry('2026-03-20', 0, 'b'); await entry('2026-03-20', 0, 'b'); await entry('2026-02-01', 0, 'c'); await entry('2025-11-01', 0, 'd');
  await entry('2026-03-20', 1, 'e'); await entry('2026-04-05', 0, 'f');

  await lead('2026-03-05 10:00'); await lead('2026-03-06 10:00', 'converted');
  await pool.query("INSERT INTO expenses (id, tenant_id, branch_id, date, description, amount, currency, category, created_at) VALUES ('ex-rr-1', ?, 'br-rr-1', ?, 'مصروف', 200, 'EGP', 'Other', NOW())", [T, at('2026-03-20 10:00')]);
});

after(async () => {
  if (!ENABLED) return;
  if (app) await app.close();
  await pool.end().catch(() => {});
});

test('the catalogue lists every report with its group and a one-line description, for the owner only', { skip }, async () => {
  const res = await app.call('GET', '/api/admin/reports/catalog', { session: admin });
  assert.equal(res.status, 200, res.text);
  const groups = new Set(res.body.map(entry => entry.group));
  assert.deepEqual([...groups].sort(), ['collections', 'finance', 'hr', 'marketing', 'operations', 'sales']);
  for (const entry of res.body) { assert.ok(entry.title && entry.description && entry.groupLabel, entry.key); assert.ok(entry.description.length < 140, `${entry.key}: one line`); }
  for (const key of ['daily-digest', 'staff-productivity', 'cohort-retention', 'branch-comparison']) assert.ok(res.body.some(entry => entry.key === key), key);
  assert.equal((await app.call('GET', '/api/admin/reports/catalog', { session: sales })).status, 403);
  assert.equal((await app.call('GET', '/api/admin/reports/catalog', {})).status, 401);
});

test('staff productivity: actions, the hours they were active in, and the actions in an active hour', { skip }, async () => {
  const { body } = await run(admin, 'staff-productivity');
  assert.deepEqual(body.rows.map(row => [row.name, row.actions, row.activeHours, row.activeDays, row.perHour]), [['بيتر', 5, 3, 2, 1.7], ['كريم', 1, 1, 1, 1]]);
});

test('client retention by signup month, certificates left out', { skip }, async () => {
  const { body } = await run(admin, 'cohort-retention');
  assert.deepEqual(body.rows, [
    { cohort: '2026-02', size: 3, m0: 33, m1: 33, m2: 33, m3: 0 },
    { cohort: '2026-03', size: 2, m0: 50, m1: 0, m2: 0, m3: 0 },
  ]);
});

test('instalment ageing on the last day of the period', { skip }, async () => {
  const { body } = await run(admin, 'installment-ageing');
  assert.deepEqual(body.rows.map(row => row.count), [1, 2, 1, 1]);
  assert.match(body.notes[0], /^4 عميل/);
});

test('the branch comparison: leads, conversion, new clients, money and the branch\'s expenses', { skip }, async () => {
  const { body } = await run(admin, 'branch-comparison');
  const row = body.rows.find(r => r.branch === 'ONLINE_EGYPT');
  assert.deepEqual({ ...row }, { branch: 'ONLINE_EGYPT', received: 2, converted: 1, rate: 50, newClients: 2, revenue: 1700, collections: 0, certificates: 0, expenses: 200, net: 1500 });
});

test('the management report\'s own figures come through unchanged', { skip }, async () => {
  const { body } = await run(admin, 'income-by-type');
  assert.deepEqual(body.rows, [{ label: 'كورسات ومسارات', payments: 2, moneyEgp: 1700 }]);
  const day = (await run(admin, 'income-by-day')).body.rows;
  assert.deepEqual(day.map(r => [r.day, r.moneyEgp]), [['2026-03-10', 700], ['2026-03-15', 1000]]);
});

test('the daily digest sets the day against yesterday and last week', { skip }, async () => {
  const { body } = await run(admin, 'daily-digest', 'from=2026-03-06&to=2026-03-06');
  const leads = body.rows.find(r => r.label === 'ليدات جديدة');
  assert.deepEqual({ today: leads.today, yesterday: leads.yesterday, lastWeek: leads.lastWeek, change: leads.change }, { today: 1, yesterday: 1, lastWeek: 0, change: 0 });
});

test('who may run them: admin yes, sales no, signed out no, an unknown report is a 404', { skip }, async () => {
  assert.equal((await run(admin, 'daily-digest')).status, 200);
  assert.equal((await run(sales, 'staff-productivity')).status, 403);
  assert.equal((await run(null, 'staff-productivity')).status, 401);
  assert.equal((await run(admin, 'no-such-report')).status, 404);
});
