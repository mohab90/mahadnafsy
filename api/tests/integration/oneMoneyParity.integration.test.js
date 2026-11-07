'use strict';
/**
 * 8 Nov 2026, «نتأكد إن كلها متطابقة»: what a client owes is worked out by ONE rule — lib/clientItems.js — for the list rows (`moneyItems`, lib/clientMoneyItems.js) and for
 * GET /api/admin/clients/:id/money (lib/clientMoney.js); the SQL balance the receipts, the instalments, the collections and the student's page read
 * (lib/agreedPrice.js itemBalances) is the same rule written as queries. This runs all three over 200 random clients — every kind of payment and status, two currencies,
 * tracks, courses inside a track, prices agreed and money paid before the system — and fails on any client where they differ by a piastre. Real MariaDB; runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-money-parity-it';
const CLIENTS = 200;
let pool;

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function clean() {
  for (const table of ['client_item_money', 'payments', 'enrollments', 'bundle_courses', 'bundles', 'courses', 'subscribers']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  for (const [id, egp, sar] of [['mp-c1', 3000, 600], ['mp-c2', 2000, 400], ['mp-c3', 1500, 0], ['mp-c4', 999.99, 150]]) {
    await pool.query(
      `INSERT INTO courses (id, tenant_id, slug, title, description, short_description, instructor, thumbnail, category, type, price_egp, price_sar, is_published)
       VALUES (?, ?, ?, ?, '', '', '', '', 'GENERAL', 'RECORDED', ?, ?, 1)`, [id, T, `${id}-it`, id, egp, sar]);
  }
  await pool.query("INSERT INTO bundles (id, tenant_id, title, description, price_egp, price_sar, is_published) VALUES ('mp-b1', ?, 'مسار', '', 4500, 900, 1)", [T]);
  await pool.query("INSERT INTO bundle_courses (tenant_id, bundle_id, course_id) VALUES (?, 'mp-b1', 'mp-c1'), (?, 'mp-b1', 'mp-c2')", [T, T]);

  const next = random(20261108);
  const pick = list => list[Math.floor(next() * list.length)];
  const subscribers = []; const payments = []; const enrolments = []; const money = [];
  for (let i = 0; i < CLIENTS; i += 1) {
    const id = `mp-s${i}`;
    subscribers.push([id, T, `MP${i}`, `عميل ${i}`, `1020${String(100000 + i)}`, pick(['DAQQI', 'ONLINE_EGYPT', 'ONLINE_SAUDI'])]);
    for (let k = Math.floor(next() * 5); k > 0; k -= 1) {
      const bundle = next() < 0.25 ? 'mp-b1' : null;
      payments.push([`mp-p${i}-${k}`, T, id, bundle ? null : pick(['mp-c1', 'mp-c2', 'mp-c3', 'mp-c4', null]), bundle,
        pick([0, 100, 500, 1000.5, 2500, 3000.25]), pick(['EGP', 'EGP', 'SAR']), pick(['COURSE', 'COURSE', 'BUNDLE', 'OTHER', 'CERTIFICATE', 'CARNEH']),
        pick(['paid', 'paid', 'paid', 'pending', 'refunded', 'failed']), pick([null, 0, 900, 2000.5, 3000, 4500]), `2026-10-${String(1 + Math.floor(next() * 28)).padStart(2, '0')}`]);
    }
    for (const course of pick([[], ['mp-c1'], ['mp-c1', 'mp-c2'], ['mp-c3'], ['mp-c1', 'mp-c2', 'mp-c4']])) enrolments.push([T, id, course, null]);
    if (next() < 0.1) enrolments.push([T, id, null, 'mp-b1']);
    for (const item of ['mp-c1', 'mp-c2', 'mp-c3', 'bundle:mp-b1']) {
      const agreed = next() < 0.2 ? pick([800, 1200.5, 2500]) : null;
      const prior = next() < 0.2 ? pick([100, 300.25, 700]) : null;
      if (agreed || prior) money.push([T, id, item, agreed, prior]);
    }
  }
  await pool.query('INSERT INTO subscribers (tenant_id, id, client_code, name, phone, branch, crm_json) VALUES ?', [subscribers.map(row => [row[1], row[0], row[2], row[3], row[4], row[5], '{}'])]);
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, course_id, bundle_id, amount, currency, fx_rate_to_egp, amount_egp, payment_type, status, course_expected, date) VALUES ?`,
    [payments.map(row => [row[0], row[1], row[2], row[3], row[4], row[5], row[6], 1, row[5], row[7], row[8], row[9], row[10]])]);
  await pool.query('INSERT INTO enrollments (id, tenant_id, subscriber_id, course_id, bundle_id, enrolled_at, status) VALUES ?', [enrolments.map(row => [`mp-e${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`, row[0], row[1], row[2], row[3], new Date(), 'active'])]);
  if (money.length) await pool.query('INSERT INTO client_item_money (tenant_id, subscriber_id, item_key, agreed_price, prior_paid) VALUES ?', [money]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

const c = value => Math.round((Number(value) || 0) * 100);

test('the nightly sample and the parity tool see no difference on the same clients', { skip }, async () => {
  const { compareClientMoney, recentClientIds } = require('../../lib/moneyParity');
  const { runReconcile, CHECKS } = require('../../lib/reconcileChecks');
  const ids = (await recentClientIds(pool, { limit: 500 })).filter(row => row.tenantId === T);
  assert.ok(ids.length > 100);
  assert.deepEqual(await compareClientMoney(pool, { tenantId: T, subscriberIds: ids.slice(0, 60).map(row => row.subscriberId) }), []);
  const check = CHECKS.find(entry => entry.key === 'client_money_readings_differ');
  assert.equal(await check.run(pool), 0, 'the nightly check');
  assert.ok(Array.isArray(await runReconcile(pool)));
});

test('the list rows, the money route and the SQL balance say the same to the piastre for 200 random clients', { skip }, async () => {
  const { clientMoney } = require('../../lib/clientMoney');
  const { itemBalances } = require('../../lib/agreedPrice');
  const { staffClientTools } = require('../../routes/admin/stafflists');
  const [rows] = await pool.query('SELECT * FROM subscribers WHERE tenant_id=? ORDER BY id', [T]);
  const shaped = await staffClientTools.shapeStaffSubscribers(T, rows);
  const rowById = new Map(shaped.map(row => [row.id, row]));
  const differences = [];
  let compared = 0;
  let withMoney = 0;
  for (const row of rows) {
    const fresh = await clientMoney(pool, { tenantId: T, subscriberId: row.id });
    const sql = await itemBalances(pool, { tenantId: T, subscriberId: row.id });
    const listed = new Map(rowById.get(row.id).moneyItems.map(line => [line.item, line]));
    const ours = new Map(fresh.items.map(line => [line.item, line]));
    const keys = new Set([...ours.keys(), ...listed.keys(), ...sql.keys()]);
    for (const key of keys) {
      compared += 1;
      const a = ours.get(key); const l = listed.get(key); const s = sql.get(key);
      const view = line => (line ? [c(line.agreed ?? line.expected), c(line.paid), c(line.priorPaid), c(line.remaining)] : null);
      const mine = view(a);
      // the row's `paid` is the total (here + before the system); the route's is what was recorded here
      const listRow = l ? [c(l.expected), c(l.paid) - c(l.priorPaid), c(l.priorPaid), c(l.remaining)] : null;
      const sqlRow = s ? [c(s.expected), c(s.paid), c(s.priorPaid), c(s.remaining)] : null;
      if (mine && (mine[1] > 0 || mine[2] > 0)) withMoney += 1;
      if (JSON.stringify(mine) !== JSON.stringify(listRow) || JSON.stringify(mine) !== JSON.stringify(sqlRow)) {
        differences.push(`${row.id} ${key}: route ${JSON.stringify(mine)} · list ${JSON.stringify(listRow)} · sql ${JSON.stringify(sqlRow)}`);
      }
    }
  }
  assert.deepEqual(differences.slice(0, 15), [], `${differences.length} differences, e.g. above`);
  assert.ok(compared > 250 && withMoney > 80, `the fixtures exercise the rule: ${compared} items, ${withMoney} with money`);
});
