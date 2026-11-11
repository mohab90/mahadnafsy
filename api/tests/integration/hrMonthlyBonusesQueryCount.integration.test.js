'use strict';
/**
 * The month's bonus is worked out in a fixed number of queries (11 Nov 2026): the agreed price of every booking used to be one lookup each (client money, the booking's price,
 * the catalogue), and the month sheet's late-bookings list read three months in three passes. Here the same month is built with 6 bookings and with 60: the number of
 * statements sent is the same, and every booking's price is the one the single lookup (agreedPrice) gives — from the client's own price, from what the booking recorded
 * and from the catalogue. Real MariaDB, a counting wrapper around the pool.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-bonus-count-it';
let pool; let bonuses; let agreed;

let seq = 0;
async function booking(id, { course, price = null, custom = null, day = 10 }) {
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, branch, assigned_sales_id) VALUES (?, ?, ?, ?, 'ONLINE_EGYPT', 'qc-rep')", [id, T, `عميل ${id}`, `10170${String(++seq).padStart(5, '0')}`]);
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, currency, fx_rate_to_egp, amount_egp, payment_type, status, course_expected, date, payment_method, staff_id)
     VALUES (?, ?, ?, ?, 1000, 'EGP', 1, 1000, 'COURSE', 'paid', ?, ?, 'كاش', 'qc-rep')`, [`pay-${id}`, T, id, course, price, `2026-09-${String(day).padStart(2, '0')} 12:00:00`]);
  if (custom) await pool.query("INSERT INTO client_item_money (tenant_id, subscriber_id, item_key, agreed_price) VALUES (?, ?, ?, ?)", [T, id, course, custom]);
}
async function clean() {
  for (const table of ['employee_bonuses', 'payments', 'client_item_money', 'subscribers', 'courses', 'staff', 'tenant_settings']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  await pool.query('DELETE FROM tenants WHERE id=?', [T]).catch(() => {});
}
/** A pool that counts the statements sent through it. */
const counting = () => { const seen = { n: 0 }; return { seen, db: { query: (...args) => { seen.n += 1; return pool.query(...args); } } }; };

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  bonuses = require('../../lib/monthlyBonuses');
  agreed = require('../../lib/agreedPrice');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'Bonus count IT', 'active')", [T, T]);
  const seeded = fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '381_v26_bonus_plan.sql'), 'utf8').match(/'bonus_plan', '(\{.*\})', 0/)[1];
  await require('../../lib/tenantSettings').setTenantSetting('bonus_plan', JSON.parse(seeded), { tenantId: T });
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, bonus_scheme, booking_first_target) VALUES ('qc-rep', ?, 'مندوب', 'qc@x.t', '1018100001', 'SALES', 1, '2025-01-01', 'SALES_BOOKINGS', 3)`, [T]);
  for (const [id, price] of [['qc1', 3000], ['qc2', 7000], ['qc3', 12000]]) {
    await pool.query(
      `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp) VALUES (?, ?, ?, '', '', '', '', 'GENERAL', 'RECORDED', ?)`, [id, T, `كورس ${id}`, price]);
  }
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

async function measure() {
  const month = counting();
  const result = await bonuses.computeMonthlyBonuses(month.db, { tenantId: T, year: 2026, month: 9 });
  const context = counting();
  const late = await bonuses.adjustmentContext(context.db, { tenantId: T, year: 2026, month: 9 });
  return { month: month.seen.n, context: context.seen.n, result, late };
}

test('the statements sent do not grow with the number of bookings, and every price is the one the single lookup gives', { skip }, async () => {
  // Six bookings in September (the client's own price, what the booking recorded, the catalogue), one in August and one in October for the late-bookings list.
  await booking('s1', { course: 'qc1', price: 3000, custom: 2500 });
  await booking('s2', { course: 'qc2', price: 7000 });
  await booking('s3', { course: 'qc3' });
  await booking('s4', { course: 'qc3', price: 12000, custom: 9000 });
  await booking('s5', { course: 'qc2' });
  await booking('s6', { course: 'qc1', price: 3000 });
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, branch, assigned_sales_id) VALUES ('s-aug', ?, 'أغسطس', '10170999991', 'ONLINE_EGYPT', 'qc-rep')", [T]);
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, currency, fx_rate_to_egp, amount_egp, payment_type, status, date, payment_method, staff_id)
     VALUES ('pay-aug', ?, 's-aug', 'qc2', 1000, 'EGP', 1, 1000, 'COURSE', 'paid', '2026-08-28 12:00:00', 'كاش', 'qc-rep')`, [T]);
  const small = await measure();
  assert.equal(small.result.employees[0].bookings.length, 6);
  const prices = Object.fromEntries(small.result.employees[0].bookings.map(item => [item.clientId, item.price]));
  assert.deepEqual(prices, { s1: 2500, s2: 7000, s3: 12000, s4: 9000, s5: 7000, s6: 3000 }, 'own price, recorded price, catalogue price');
  // The single lookup, one booking at a time, gives the same figure for each.
  for (const entry of small.result.employees[0].bookings) {
    const single = await agreed.agreedPrice(pool, { tenantId: T, subscriberId: entry.clientId, courseId: entry.item, currency: 'EGP' });
    assert.equal(entry.price, single, `booking of ${entry.clientId}`);
  }
  assert.equal(small.late.adjacentBookings.length, 1, 'the August booking is a late-booking candidate');

  for (let i = 0; i < 54; i += 1) await booking(`m${i}`, { course: ['qc1', 'qc2', 'qc3'][i % 3], price: i % 2 ? [3000, 7000, 12000][i % 3] : null, custom: i % 5 === 0 ? 1111 : null, day: 1 + (i % 28) });
  const large = await measure();
  assert.equal(large.result.employees[0].bookings.length, 60);
  assert.equal(large.month, small.month, `the month's bonus: ${small.month} statements for 6 bookings, ${large.month} for 60`);
  assert.equal(large.context, small.context, `the adjustment context: ${small.context} for 6, ${large.context} for 60`);
  assert.ok(large.month <= 20, `a handful of statements for the month (${large.month})`);
  for (const entry of large.result.employees[0].bookings) {
    const single = await agreed.agreedPrice(pool, { tenantId: T, subscriberId: entry.clientId, courseId: entry.item, currency: 'EGP' });
    assert.equal(entry.price, single, `booking of ${entry.clientId}`);
  }
});
