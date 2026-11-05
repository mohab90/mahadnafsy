'use strict';
/**
 * 5 Nov 2026, clientView slice 4: a client's «remaining» is computed twice — in SQL by lib/agreedPrice.js itemBalances (the student's page, the receipt, the item-money
 * screen) and in JS by lib/staffClientsView.js balanceOf (the staff lists, their «remaining» filter and the overview's total). They must say the same number for the same
 * client, or a collector and the client are shown different debts. This runs both over clients of every shape the rules treat differently. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-balances-one-reading-it';
let pool;

async function clean() {
  for (const table of ['client_item_money', 'payments', 'enrollments', 'bundle_courses', 'bundles', 'courses', 'subscribers']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}
const pay = (id, sub, { course = null, bundle = null, amount, expected, status = 'paid', type = 'COURSE' }) => pool.query(
  `INSERT INTO payments (id, tenant_id, subscriber_id, course_id, bundle_id, amount, currency, fx_rate_to_egp, amount_egp, payment_type, status, course_expected, date)
   VALUES (?, ?, ?, ?, ?, ?, 'EGP', 1, ?, ?, ?, ?, '2026-10-01')`, [id, T, sub, course, bundle, amount, amount, type, status, expected]);
const enrol = (sub, course, bundle = null) => pool.query(
  "INSERT INTO enrollments (id, tenant_id, subscriber_id, course_id, bundle_id, enrolled_at, status) VALUES (UUID(), ?, ?, ?, ?, NOW(), 'active')", [T, sub, course, bundle]);

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  for (const [id, price] of [['br-c1', 3000], ['br-c2', 2000], ['br-c3', 1500]]) {
    await pool.query(
      `INSERT INTO courses (id, tenant_id, slug, title, description, short_description, instructor, thumbnail, category, type, price_egp, is_published)
       VALUES (?, ?, ?, ?, '', '', '', '', 'GENERAL', 'RECORDED', ?, 1)`, [id, T, `${id}-it`, id, price]);
  }
  await pool.query("INSERT INTO bundles (id, tenant_id, title, description, price_egp, is_published) VALUES ('br-b1', ?, 'مسار', '', 4500, 1)", [T]);
  await pool.query("INSERT INTO bundle_courses (tenant_id, bundle_id, course_id) VALUES (?, 'br-b1', 'br-c1'), (?, 'br-b1', 'br-c2')", [T, T]);
  const clients = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  for (const [i, k] of clients.entries()) {
    await pool.query("INSERT INTO subscribers (id, tenant_id, client_code, name, phone, branch, crm_json) VALUES (?, ?, ?, ?, ?, 'DAQQI', '{}')", [`br-s${k}`, T, `BR${k}`, `عميل ${k}`, `10199000${i}1`]);
  }
  // A: one course, part paid in the system and part before it
  await enrol('br-sA', 'br-c1'); await pay('br-pA', 'br-sA', { course: 'br-c1', amount: 1000, expected: 3000 });
  await pool.query("INSERT INTO client_item_money (tenant_id, subscriber_id, item_key, prior_paid) VALUES (?, 'br-sA', 'br-c1', 500)", [T]);
  // B: holds the track, paid part of it as a track
  await enrol('br-sB', 'br-c1', 'br-b1'); await enrol('br-sB', 'br-c2', 'br-b1');
  await pay('br-pB', 'br-sB', { bundle: 'br-b1', amount: 2000, expected: 4500, type: 'BUNDLE' });
  // C: an agreed price below the list price, nothing paid
  await enrol('br-sC', 'br-c3');
  await pool.query("INSERT INTO client_item_money (tenant_id, subscriber_id, item_key, agreed_price) VALUES (?, 'br-sC', 'br-c3', 1200)", [T]);
  // D: two courses, one paid in full, one not touched
  await enrol('br-sD', 'br-c2'); await enrol('br-sD', 'br-c3');
  await pay('br-pD', 'br-sD', { course: 'br-c2', amount: 2000, expected: 2000 });
  // E: every course of the track held, bought as courses, the track never booked
  await enrol('br-sE', 'br-c1'); await enrol('br-sE', 'br-c2');
  await pay('br-pE1', 'br-sE', { course: 'br-c1', amount: 1000, expected: 3000 });
  await pay('br-pE2', 'br-sE', { course: 'br-c2', amount: 500, expected: 2000 });
  // F: one course of the track only — not the track, so a course on its own
  await enrol('br-sF', 'br-c1'); await pay('br-pF', 'br-sF', { course: 'br-c1', amount: 1000, expected: 3000 });
  // G: the track (booked as a track) and one more course outside it
  await enrol('br-sG', 'br-c1', 'br-b1'); await enrol('br-sG', 'br-c2', 'br-b1'); await enrol('br-sG', 'br-c3');
  await pay('br-pG1', 'br-sG', { bundle: 'br-b1', amount: 4500, expected: 4500, type: 'BUNDLE' }); await pay('br-pG2', 'br-sG', { course: 'br-c3', amount: 500, expected: 1500 });
  // H: every course of the track held, bought apart, with money paid before the system on one of them and a price agreed for the track
  await enrol('br-sH', 'br-c1'); await enrol('br-sH', 'br-c2');
  await pay('br-pH', 'br-sH', { course: 'br-c2', amount: 700, expected: 2000 });
  await pool.query("INSERT INTO client_item_money (tenant_id, subscriber_id, item_key, prior_paid) VALUES (?, 'br-sH', 'br-c1', 800)", [T]);
  await pool.query("INSERT INTO client_item_money (tenant_id, subscriber_id, item_key, agreed_price) VALUES (?, 'br-sH', 'bundle:br-b1', 4000)", [T]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('the staff list and the SQL balance say the same remaining for every shape of client', { skip }, async () => {
  const { staffClientTools } = require('../../routes/admin/stafflists');
  const { balanceOf, toEgp } = require('../../lib/staffClientsView');
  const { itemBalances } = require('../../lib/agreedPrice');
  const [courses] = await pool.query('SELECT id, price_egp, price_sar, price_usd FROM courses WHERE tenant_id=?', [T]);
  const [bundles] = await pool.query(
    `SELECT b.id, b.price_egp, b.price_sar, b.price_usd, GROUP_CONCAT(bc.course_id) AS course_ids FROM bundles b
       LEFT JOIN bundle_courses bc ON bc.bundle_id = b.id WHERE b.tenant_id=? GROUP BY b.id`, [T]);
  const priceOf = row => ({ EGP: Number(row.price_egp) || 0, SAR: Number(row.price_sar) || 0, USD: Number(row.price_usd) || 0 });
  const catalogue = {
    courses: new Map(courses.map(row => [row.id, { price: priceOf(row) }])),
    bundles: new Map(bundles.map(row => [row.id, { price: priceOf(row), courseIds: row.course_ids ? String(row.course_ids).split(',') : [] }])),
  };
  const clients = await staffClientTools.loadShapedByIds(T, ['br-sA', 'br-sB', 'br-sC', 'br-sD', 'br-sE', 'br-sF', 'br-sG', 'br-sH']);
  const answers = {};
  for (const client of clients) {
    const items = await itemBalances(pool, { tenantId: T, subscriberId: client.id });
    answers[client.id] = {
      list: balanceOf(client, catalogue).remainingEgp,
      sql: [...items.values()].reduce((sum, item) => sum + toEgp(item.remaining, item.currency), 0),
    };
  }
  // what a person would work out: A 3000-1000-500, B 4500-2000, C 1200, D 1500 (the course not touched)
  assert.deepEqual({ A: answers['br-sA'].sql, B: answers['br-sB'].sql, C: answers['br-sC'].sql, D: answers['br-sD'].sql }, { A: 1500, B: 2500, C: 1200, D: 1500 }, 'the SQL balance');
  assert.deepEqual({ A: answers['br-sA'].list, B: answers['br-sB'].list, C: answers['br-sC'].list, D: answers['br-sD'].list }, { A: 1500, B: 2500, C: 1200, D: 1500 }, 'the staff list balance');
  for (const id of Object.keys(answers)) assert.equal(answers[id].list, answers[id].sql, `${id}: the list says ${answers[id].list}, the SQL says ${answers[id].sql}`);
  // every course of a track held, bought apart, is the track to both: 4500 less the 1500 paid for its courses (3000); one course alone stays a course (2000);
  // the track booked as a track plus another course owes only the course (1000); and a price agreed for the track (4000) less 700 paid and 800 paid before = 2500
  assert.deepEqual({ E: answers['br-sE'].sql, F: answers['br-sF'].sql, G: answers['br-sG'].sql, H: answers['br-sH'].sql }, { E: 3000, F: 2000, G: 1000, H: 2500 });
});
