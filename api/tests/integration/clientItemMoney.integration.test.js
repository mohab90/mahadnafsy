'use strict';
/**
 * 3 Nov 2026, «انقل الأسعار المتفق عليها ومدفوع قبل السيستم من crm_json لجدول»: against a real MariaDB — the table's writers and readers (lib/itemMoney.js), the balance rule over
 * them (lib/agreedPrice.js), the roster's SQL that reads «مدفوع قبل السيستم» by the round's course (collations of two tables meet in it), the outstanding-balances SQL, and the
 * client detail that sends the maps to the screen. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-item-money-it';
let pool;

async function clean() {
  for (const table of ['client_item_money', 'daqqi_attendees', 'daqqi_rounds', 'payments', 'enrollments', 'courses', 'subscribers']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await pool.query(
    `INSERT INTO courses (id, tenant_id, slug, title, description, short_description, instructor, thumbnail, category, type, price_egp, is_published)
     VALUES ('im-c1', ?, 'im-c1-it', 'كورس أ', '', '', '', '', 'GENERAL', 'RECORDED', 3000, 1)`, [T]);
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, client_code, name, phone, branch, crm_json) VALUES
       ('im-s1', ?, 'IM1', 'عميل أول', '1017100001', 'DAQQI', '{"market":"local"}'),
       ('im-s2', ?, 'IM2', 'عميل تاني', '1017100002', 'DAQQI', '{}')`, [T, T]);
  await pool.query(
    `INSERT INTO daqqi_rounds (id, tenant_id, code, course_id, instructor_name, reception_name, day_of_week, start_date, time_slot, status, branch)
     VALUES ('im-r1', ?, '9101', 'im-c1', '', '', 'السبت', '2026-09-05', 'EVENING', 'ACTIVE', 'DAQQI')`, [T]);
  await pool.query(
    `INSERT INTO daqqi_attendees (round_id, subscriber_id, tenant_id, name, phone, booked_at)
     VALUES ('im-r1', 'im-s1', ?, 'عميل أول', '1017100001', NOW()), ('im-r1', 'im-s2', ?, 'عميل تاني', '1017100002', NOW())`, [T, T]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('a price and a prior payment are rows: set, read as the two maps, changed apart, and a row with neither number is gone', { skip }, async () => {
  const { setItemMoney, moneyOf, loadItemMoney, replaceItemMoney } = require('../../lib/itemMoney');
  await setItemMoney(pool, { tenantId: T, subscriberId: 'im-s1', itemKey: 'im-c1', price: 2500 });
  await setItemMoney(pool, { tenantId: T, subscriberId: 'im-s1', itemKey: 'im-c1', priorPaid: 1000 });
  assert.deepEqual(await moneyOf(pool, { tenantId: T, subscriberId: 'im-s1' }), { customPrices: { 'im-c1': 2500 }, priorPaid: { 'im-c1': 1000 } }, 'one number does not touch the other');
  await setItemMoney(pool, { tenantId: T, subscriberId: 'im-s1', itemKey: 'im-c1', price: 0 });
  assert.deepEqual(await moneyOf(pool, { tenantId: T, subscriberId: 'im-s1' }), { customPrices: {}, priorPaid: { 'im-c1': 1000 } });
  await setItemMoney(pool, { tenantId: T, subscriberId: 'im-s1', itemKey: 'im-c1', priorPaid: 0 });
  const [[count]] = await pool.query('SELECT COUNT(*) n FROM client_item_money WHERE tenant_id=? AND subscriber_id=?', [T, 'im-s1']);
  assert.equal(Number(count.n), 0);
  await replaceItemMoney(pool, { tenantId: T, subscriberId: 'im-s1', customPrices: { 'bundle:b1': 5000 }, priorPaid: { 'bundle:b1': 500, 'im-c1': 0 } });
  assert.deepEqual((await loadItemMoney(pool, { tenantId: T, subscriberIds: ['im-s1', 'im-s2'] })).get('im-s1'), { customPrices: { 'bundle:b1': 5000 }, priorPaid: { 'bundle:b1': 500 } });
  assert.equal((await loadItemMoney(pool, { tenantId: T, subscriberIds: null })).has('im-s2'), false, 'a client with nothing has no entry');
});

test('the balance rule reads the table: the client\'s price, what was paid before the system, and a transfer that carries it', { skip }, async () => {
  const { setAgreedPrice, setPriorPaid, itemBalances, releaseItemMoney, agreedPrice } = require('../../lib/agreedPrice');
  await pool.query('DELETE FROM client_item_money WHERE tenant_id=?', [T]);
  await setAgreedPrice(pool, { tenantId: T, subscriberId: 'im-s1', courseId: 'im-c1', price: 2800 });
  await setPriorPaid(pool, { tenantId: T, subscriberId: 'im-s1', courseId: 'im-c1', amount: 900 });
  assert.equal(await agreedPrice(pool, { tenantId: T, subscriberId: 'im-s1', courseId: 'im-c1' }), 2800);
  await pool.query("INSERT INTO enrollments (id, tenant_id, subscriber_id, course_id, enrolled_at, status) VALUES (UUID(), ?, 'im-s1', 'im-c1', NOW(), 'active')", [T]);
  const balance = (await itemBalances(pool, { tenantId: T, subscriberId: 'im-s1' })).get('im-c1');
  assert.deepEqual([balance.expected, balance.priorPaid, balance.remaining], [2800, 900, 1900]);
  const released = await releaseItemMoney(pool, { tenantId: T, subscriberId: 'im-s1', from: { courseId: 'im-c1' }, to: { bundleId: 'b9' } });
  assert.deepEqual(released, { price: 2800, priorPaid: 900 });
  const [rows] = await pool.query('SELECT item_key, agreed_price, prior_paid FROM client_item_money WHERE tenant_id=? AND subscriber_id=?', [T, 'im-s1']);
  assert.deepEqual(rows.map(row => [row.item_key, row.agreed_price, Number(row.prior_paid)]), [['bundle:b9', null, 900]], 'the price goes, what was paid before moves with the client to the new item');
});

test('the round roster reads «مدفوع قبل السيستم» from the table by the round\'s own course', { skip }, async () => {
  const { getDaqqiAttendees } = require('../../lib/daqqiAttendees');
  await pool.query('DELETE FROM client_item_money WHERE tenant_id=?', [T]);
  await pool.query("INSERT INTO client_item_money (tenant_id, subscriber_id, item_key, prior_paid) VALUES (?, 'im-s1', 'im-c1', 1500), (?, 'im-s2', 'another-course', 700)", [T, T]);
  const rows = await getDaqqiAttendees(pool, T, ['im-r1']);
  const byClient = Object.fromEntries(rows.map(row => [row.subscriber_id, Number(row.prior_paid)]));
  assert.deepEqual(byClient, { 'im-s1': 1500, 'im-s2': 0 });
});

test('the outstanding balances take «مدفوع قبل السيستم» off in SQL', { skip }, async () => {
  const { loadOutstandingBalances } = require('../../lib/outstandingBalances');
  await pool.query('DELETE FROM client_item_money WHERE tenant_id=?', [T]);
  await pool.query("INSERT INTO client_item_money (tenant_id, subscriber_id, item_key, prior_paid) VALUES (?, 'im-s1', 'im-c1', 1000)", [T]);
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, currency, fx_rate_to_egp, amount_egp, payment_type, status, course_expected, date)
     VALUES ('im-p1', ?, 'im-s1', 'im-c1', 500, 'EGP', 1, 500, 'COURSE', 'paid', 2000, NOW())`, [T]);
  const rows = await loadOutstandingBalances(T, null);
  const mine = rows.find(row => row.id === 'im-s1');
  assert.ok(mine, 'owes: 2000 − 500 paid − 1000 before the system');
  assert.deepEqual([Number(mine.total_paid), Number(mine.outstanding)], [1500, 500]);
  assert.equal('prior_paid' in mine, false);
});
