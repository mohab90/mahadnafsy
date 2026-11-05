'use strict';
/**
 * 4 Nov 2026: «نظرة عامة» of مركز التسويق reads GET /api/admin/marketing/overview — leads by status and source, collected EGP money, a daily line, the period before it for
 * comparison, and the leads nobody touched in two days — instead of counting the whole lead and order tables in the browser. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-marketing-overview-it';
// The institute's day is Cairo's; the database session's CURDATE() is UTC's, which is still yesterday between 00:00 and 02:00 Cairo (the test failed in that window).
const { cairoToday, addDaysToDateOnly } = require('../../lib/dates');
let pool, router;

async function clean() {
  for (const table of ['payments', 'leads', 'subscribers']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
}
const get = async query => {
  const layer = router.stack.find(l => l.route?.path === '/api/admin/marketing/overview');
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await layer.route.stack.at(-1).handle({ params: {}, query, body: {}, headers: {}, tenantId: T, user: { uid: 'admin' }, staffRecord: null, isSuperAdmin: true, ip: '1', get: () => undefined }, res);
  return res;
};

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/analytics/sales');
  await clean();
  await pool.query("INSERT INTO subscribers (id, tenant_id, client_code, name, phone, branch) VALUES ('mo-s1', ?, 'MO1', 'عميل', '1019300001', 'ONLINE_EGYPT')", [T]);
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, amount, currency, fx_rate_to_egp, amount_egp, payment_type, status, date) VALUES
       ('mo-p1', ?, 'mo-s1', 1000, 'EGP', 1, 1000, 'COURSE', 'paid', ?),
       ('mo-p2', ?, 'mo-s1', 100, 'SAR', 14, 1400, 'COURSE', 'paid', ?),
       ('mo-p3', ?, 'mo-s1', 500, 'EGP', 1, 500, 'COURSE', 'pending', ?),
       -- a payment made at 14:30 today, as the online and instalment writers store them (NOW()): a date-only upper bound stopped at midnight and lost it
       ('mo-p4', ?, 'mo-s1', 250, 'EGP', 1, 250, 'COURSE', 'paid', ?)`,
    [T, cairoToday(), T, addDaysToDateOnly(cairoToday(), -10), T, cairoToday(), T, `${cairoToday()} 14:30:00`]);
  await pool.query(
    `INSERT INTO leads (id, tenant_id, name, phone, source, status, branch, hidden, created_at) VALUES
       ('mo-l1', ?, 'ليد ١', '1019400001', 'facebook', 'new', 'ONLINE_EGYPT', 0, NOW()),
       ('mo-l2', ?, 'ليد ٢', '1019400002', 'facebook', 'converted', 'ONLINE_EGYPT', 0, NOW()),
       ('mo-l3', ?, 'ليد ٣', '1019400003', 'instagram', 'new', 'ONLINE_EGYPT', 0, NOW() - INTERVAL 10 DAY),
       ('mo-l4', ?, 'مخفي', '1019400004', 'facebook', 'new', 'ONLINE_EGYPT', 1, NOW())`, [T, T, T, T]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('7 days: this week\'s leads and money, the week before it, a line per day, and the leads nobody touched', { skip }, async () => {
  const { body, statusCode } = await get({ range: '7d' });
  assert.equal(statusCode, 200);
  assert.equal(body.range, '7d');
  assert.deepEqual(body.current.leads.map(row => [row.status, row.source, row.n]).sort(), [['converted', 'facebook', 1], ['new', 'facebook', 1]]);
  assert.equal(body.current.revenue, 1250, 'the paid 1,000 of today and the 250 paid at 14:30; the pending 500 and the 10-day-old payment are outside');
  assert.deepEqual(body.previous.leads.map(row => [row.status, row.source, row.n]), [['new', 'instagram', 1]], 'the week before holds the lead of ten days ago');
  assert.equal(body.previous.revenue, 1400);
  assert.equal(body.daily.length, 7, 'one point per day of the range');
  assert.equal(body.daily.at(-1).leads, 2);
  assert.equal(body.daily.at(-1).converted, 1);
  assert.equal(body.daily.at(-1).revenue, 1250, 'today\'s last day holds the payment made at 14:30 too');
  assert.equal(body.untouchedLeads, 1, 'the new lead of 10 days ago; the hidden one does not count');
});

test('all time has nothing to compare with and still draws only thirty days', { skip }, async () => {
  const { body } = await get({ range: 'all' });
  assert.equal(body.previous, null);
  assert.equal(body.current.revenue, 2650);
  assert.equal(body.current.leads.reduce((sum, row) => sum + row.n, 0), 3);
  assert.equal(body.daily.length, 30);
});

test('an unknown range is the month', { skip }, async () => {
  assert.equal((await get({ range: 'nonsense' })).body.range, 'month');
});
