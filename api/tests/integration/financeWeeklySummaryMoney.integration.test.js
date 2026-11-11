'use strict';
/**
 * The Sunday summary email's money (api/lib/weeklySummary.js) on a real MariaDB. It used to add payments.amount as it stood — 500 riyals as 500 pounds, 100 dollars as 100 pounds.
 * The week: course 1000 EGP, a Saudi course 400 SAR (stored 4000 EGP), 50 USD (stored 2500 EGP), a certificate 300 EGP, a 200 SAR payment with no pound value stored
 * (counted apart, not as 200 pounds), and the rows that are not money: pending, deleted, older than the week. The week before: 1000 EGP and 1000 SAR stored as 10000 EGP.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-weekly-money-it';
let pool;

const { cairoToday, cairoDayStartUtc, addDaysToDateOnly } = require('../../lib/dates');

const TODAY = cairoToday();
const noon = daysAgo => new Date(new Date(cairoDayStartUtc(addDaysToDateOnly(TODAY, -daysAgo))).getTime() + 12 * 3600 * 1000);
let seq = 0;
const payment = (daysAgo, amount, currency, amountEgp, { type = 'COURSE', status = 'paid', deleted = false } = {}) => pool.query(
  `INSERT INTO payments (id, tenant_id, subscriber_id, date, amount, currency, amount_egp, payment_type, status, payment_method, deleted_at, created_at)
   VALUES (?, ?, 'sub-wk-1', ?, ?, ?, ?, ?, ?, 'كاش', ?, ?)`,
  [`pay-wk-${++seq}`, T, noon(daysAgo), amount, currency, amountEgp, type, status, deleted ? new Date() : null, noon(daysAgo)]);

async function clean() {
  for (const table of ['payments', 'subscribers']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, branch) VALUES ('sub-wk-1', ?, 'عميل', '1019900010', 'ONLINE_EGYPT')", [T]);
  await payment(1, 1000, 'EGP', 1000);
  await payment(2, 400, 'SAR', 4000);
  await payment(3, 50, 'USD', 2500);
  await payment(2, 300, 'EGP', 300, { type: 'CERTIFICATE' });
  await payment(4, 200, 'SAR', null);
  await payment(1, 999, 'EGP', 999, { status: 'pending' });
  await payment(1, 888, 'EGP', 888, { deleted: true });
  await payment(20, 777, 'EGP', 777);
  await payment(9, 1000, 'EGP', 1000);
  await payment(10, 1000, 'SAR', 10000);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('the week\'s money is in pounds from the stored pound value, with certificates apart and an unconvertible payment counted, not added', { skip }, async () => {
  const { weeklyMoney } = require('../../lib/weeklySummary');
  const money = await weeklyMoney(pool, { tenantId: T, today: TODAY });
  assert.equal(money.courseEgp, 1000 + 4000 + 2500, 'riyals and dollars at their pound value — not 1000 + 400 + 50');
  assert.equal(money.certificateEgp, 300);
  assert.equal(money.totalEgp, 7800);
  assert.equal(money.unconverted, 1, 'the 200 riyals with no pound value are named, not counted as 200 pounds');
  assert.equal(money.previousTotalEgp, 11000, 'the week before, the same way');
  assert.equal(money.changePct, Math.round(((7800 - 11000) / 11000) * 1000) / 10);
  assert.equal(money.from, addDaysToDateOnly(TODAY, -7));
});

test('with nothing the week before there is no percentage to state', { skip }, async () => {
  const { weeklyMoney } = require('../../lib/weeklySummary');
  await pool.query("DELETE FROM payments WHERE tenant_id=? AND date < ?", [T, cairoDayStartUtc(addDaysToDateOnly(TODAY, -7))]);
  const money = await weeklyMoney(pool, { tenantId: T, today: TODAY });
  assert.equal(money.previousTotalEgp, 0);
  assert.equal(money.changePct, null);
});
