'use strict';
/**
 * «نظام المكافآت» — one month (September 2026) worked out from payments on a real MariaDB, with the plan migration 381 seeds (the owner's numbers).
 *
 *   courses       c1 3,000 EGP (1 booking) · c2 7,000 EGP / 600 SAR (2 bookings; the desk's bonus on its page: 150) · c3 12,000 EGP (3 bookings)
 *   rep A         first target 10: bookings c3, c3, c2, c2 paid in SAR at 14 (8,400 EGP: 2), c1 → 11 → 1,000
 *                 (a client first paid in August is not September's booking; a deleted payment is no booking)
 *   rep B         first target 15: c3 × 4 → 12, under it on her own; with the desk's two c2 bookings of her clients → 16 → 1,500
 *   desk C        collection + bookings, levels from 0 at 1%: records two c2 bookings (A's clients' ladder is not hers) → 150 × 2 = 300, + 1% of the
 *                 2,000 she took = 20 → 320
 *   collector D   levels 10,000 at 2%, 30,000 at 3%: instalments 35,000 (a certificate's 5,000 is not course money) → 1,050
 *
 * Runs only with DB_* (or TEST_DB_*).
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
const T = 'tenant-bonus-it';
let pool; let bonuses;

let seq = 0;
const at = day => `2026-09-${String(day).padStart(2, '0')} 12:00:00`;
async function pay({ client, course, amount, staff, day = 10, currency = 'EGP', fx = 1, expected, type = 'COURSE', installment = 0, deleted = false, date }) {
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, currency, fx_rate_to_egp, amount_egp, payment_type, status, course_expected, date,
       payment_method, staff_id, is_installment, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, 'كاش', ?, ?, ?)`,
    [`pay-bn-${++seq}`, T, client, course, amount, currency, fx, amount * fx, type, expected ?? null, date || at(day), staff || null, installment, deleted ? new Date() : null]);
}
const client = (id, rep, collector = null) => pool.query(
  "INSERT INTO subscribers (id, tenant_id, name, phone, branch, assigned_sales_id, assigned_cs_id) VALUES (?, ?, ?, ?, 'ONLINE_EGYPT', ?, ?)",
  [id, T, `عميل ${id}`, `10190${String(++seq).padStart(5, '0')}`, rep, collector]);
const staff = (id, role, scheme, extra = {}) => pool.query(
  `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, bonus_scheme, booking_first_target, collection_levels_json)
   VALUES (?, ?, ?, ?, ?, ?, 1, '2025-01-01', ?, ?, ?)`,
  [id, T, `موظف ${id}`, `${id}@bn.test`, `10180${String(++seq).padStart(5, '0')}`, role, scheme, extra.firstTarget ?? null, extra.levels ? JSON.stringify(extra.levels) : null]);

async function clean() {
  for (const table of ['employee_bonuses', 'payments', 'client_item_money', 'subscribers', 'courses', 'staff', 'tenant_settings']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  bonuses = require('../../lib/monthlyBonuses');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'Bonus IT', 'active')", [T, T]);
  const seeded = fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '381_v26_bonus_plan.sql'), 'utf8').match(/'bonus_plan', '(\{.*\})', 0/)[1];
  await require('../../lib/tenantSettings').setTenantSetting('bonus_plan', JSON.parse(seeded), { tenantId: T });
  for (const [id, price, bonusesJson] of [['c1', 3000, null], ['c2', 7000, JSON.stringify({ service: { type: 'fixed', value: 150 }, sales: { type: 'fixed', value: 999 } })], ['c3', 12000, null]]) {
    await pool.query(
      `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp, booking_bonuses_json)
       VALUES (?, ?, ?, '', '', '', '', 'GENERAL', 'RECORDED', ?, ?)`, [id, T, `كورس ${id}`, price, bonusesJson]);
  }
  await staff('rep-a', 'SALES', 'SALES_BOOKINGS', { firstTarget: 10 });
  await staff('rep-b', 'SALES', 'SALES_BOOKINGS', { firstTarget: 15 });
  await staff('desk-c', 'RECEPTION_DAQQI', 'COLLECTION_BOOKINGS', { levels: [{ from: 0, kind: 'percent', value: 1 }] });
  await staff('coll-d', 'COLLECTION', 'COLLECTION', { levels: [{ from: 10000, kind: 'percent', value: 2 }, { from: 30000, kind: 'percent', value: 3 }] });
  await staff('rep-none', 'SALES', 'NONE');

  // Rep A: five bookings worth 11.
  for (const [id, course, amount, extra] of [['a1', 'c3', 2000], ['a2', 'c3', 2000], ['a3', 'c2', 1000], ['a4', 'c2', 100, { currency: 'SAR', fx: 14, expected: 600 }], ['a5', 'c1', 3000]]) {
    await client(id, 'rep-a');
    await pay({ client: id, course, amount, staff: 'rep-a', expected: extra?.expected ?? { c1: 3000, c2: 7000, c3: 12000 }[course], ...extra });
  }
  await client('a6', 'rep-a');
  await pay({ client: 'a6', course: 'c3', amount: 2000, staff: 'rep-a', expected: 12000, date: '2026-08-20 12:00:00' });
  await pay({ client: 'a6', course: 'c3', amount: 2000, staff: 'rep-a', expected: 12000, installment: 1 });
  await client('a7', 'rep-a');
  await pay({ client: 'a7', course: 'c3', amount: 2000, staff: 'rep-a', expected: 12000, deleted: true });
  // Rep B: four c3 → 12, under the first target of 15.
  for (const id of ['b1', 'b2', 'b3', 'b4']) { await client(id, 'rep-b'); await pay({ client: id, course: 'c3', amount: 1000, staff: 'rep-b', expected: 12000 }); }
  // Desk C records two c2 bookings of rep B's clients.
  for (const id of ['c-1', 'c-2']) { await client(id, 'rep-b'); await pay({ client: id, course: 'c2', amount: 1000, staff: 'desk-c', expected: 7000 }); }
  // Collector D: instalments of clients booked in August, and a certificate.
  for (const [id, amount] of [['d1', 20000], ['d2', 15000]]) {
    await client(id, 'rep-none', 'coll-d');
    await pay({ client: id, course: 'c3', amount: 1000, staff: 'rep-none', expected: 40000, date: '2026-08-01 12:00:00' });
    await pay({ client: id, course: 'c3', amount, staff: 'coll-d', expected: 40000, installment: 1 });
  }
  await pay({ client: 'd1', course: null, amount: 5000, staff: 'coll-d', type: 'CERTIFICATE' });
});
after(async () => { if (!ENABLED) return; await clean(); await pool.end(); });

const byId = result => Object.fromEntries(result.employees.map(item => [item.staffId, item]));

test('each employee\'s September bonus by their scheme, from the payments', { skip }, async () => {
  const result = await bonuses.computeMonthlyBonuses(pool, { tenantId: T, year: 2026, month: 9 });
  const who = byId(result);
  assert.deepEqual(Object.keys(who).sort(), ['coll-d', 'desk-c', 'rep-a', 'rep-b'], 'an employee on no scheme is not listed');
  assert.equal(who['rep-a'].ladder.bookings, 11);
  assert.deepEqual(who['rep-a'].bookings.map(item => item.weight).sort(), [1, 2, 2, 3, 3], 'c1 one, c2 two (the SAR one at 8,400 EGP too), c3 three');
  assert.equal(who['rep-a'].bookings.find(item => item.currency === 'SAR').priceEgp, 8400);
  assert.equal(who['rep-a'].total, 1000);
  assert.equal(who['rep-b'].ladder.bookings, 16, 'four c3 (12) and the desk\'s two c2 of her clients (4)');
  assert.equal(who['rep-b'].total, 1500, 'past her first target of 15, short of 20');
  assert.equal(who['desk-c'].deskBonus, 300);
  assert.equal(who['desk-c'].collection.collected, 2000);
  assert.equal(who['desk-c'].total, 320);
  assert.equal(who['coll-d'].collection.collected, 35000, 'the certificate is not course money');
  assert.equal(who['coll-d'].total, 1050);
  assert.equal(result.total, 3870);
});

test('the course page\'s sales bonus counts only while the plan switches it on', { skip }, async () => {
  const settings = require('../../lib/tenantSettings');
  const plan = await settings.getTenantSetting('bonus_plan', { tenantId: T });
  await settings.setTenantSetting('bonus_plan', { ...plan, courseSalesBonusEnabled: true }, { tenantId: T });
  const on = byId(await bonuses.computeMonthlyBonuses(pool, { tenantId: T, year: 2026, month: 9 }));
  assert.equal(on['rep-a'].total, 1000 + 999 * 2, 'two c2 bookings at 999 each on top of the ladder');
  await settings.setTenantSetting('bonus_plan', plan, { tenantId: T });
});

test('saved as one bonus per employee awaiting approval; saved again it replaces it; an approved one is kept and said', { skip }, async () => {
  const save = async () => {
    const conn = await pool.getConnection();
    try { await conn.beginTransaction(); const result = await bonuses.saveMonthlyBonuses(conn, { tenantId: T, year: 2026, month: 9 }); await conn.commit(); return result; } finally { conn.release(); }
  };
  const first = await save();
  assert.deepEqual(first.written.map(item => [item.staffId, item.amount]).sort(), [['coll-d', 1050], ['desk-c', 320], ['rep-a', 1000], ['rep-b', 1500]]);
  const rows = async () => (await pool.query("SELECT staff_id, amount, status FROM employee_bonuses WHERE tenant_id=? AND source='BONUS_PLAN' ORDER BY staff_id", [T]))[0]
    .map(row => [row.staff_id, Number(row.amount), row.status]);
  assert.deepEqual(await rows(), [['coll-d', 1050, 'PENDING'], ['desk-c', 320, 'PENDING'], ['rep-a', 1000, 'PENDING'], ['rep-b', 1500, 'PENDING']]);
  await pool.query("UPDATE employee_bonuses SET status='APPROVED' WHERE tenant_id=? AND staff_id='coll-d'", [T]);
  await pool.query("UPDATE staff SET collection_levels_json=? WHERE id='coll-d' AND tenant_id=?", [JSON.stringify([{ from: 0, kind: 'fixed', value: 700 }]), T]);
  await pool.query("UPDATE staff SET booking_first_target=15 WHERE id='rep-a' AND tenant_id=?", [T]);
  const second = await save();
  assert.deepEqual(second.kept.map(item => [item.staffId, item.status, item.amount, item.now]), [['coll-d', 'APPROVED', 1050, 700]], 'an approved bonus is not rewritten; the new figure is said');
  assert.deepEqual(second.cleared, ['rep-a'], 'rep A now under her first target: her pending bonus goes');
  assert.deepEqual(await rows(), [['coll-d', 1050, 'APPROVED'], ['desk-c', 320, 'PENDING'], ['rep-b', 1500, 'PENDING']]);
});

test('a rep\'s ladder per half month (9 Nov 2026): each round on the whole ladder, the bonus the two added; the collectors stay monthly', { skip }, async () => {
  // Rep A: 11 bookings in the first half (the 10th); four c3 more on the 20th → 12 in the second half.
  for (const id of ['a8', 'a9', 'a10', 'a11']) { await client(id, 'rep-a'); await pay({ client: id, course: 'c3', amount: 1000, staff: 'rep-a', expected: 12000, day: 20 }); }
  await pool.query("UPDATE staff SET booking_first_target=10 WHERE id='rep-a' AND tenant_id=?", [T]);
  const settings = require('../../lib/tenantSettings');
  const plan = await settings.getTenantSetting('bonus_plan', { tenantId: T });
  const monthly = byId(await bonuses.computeMonthlyBonuses(pool, { tenantId: T, year: 2026, month: 9 }));
  assert.deepEqual([monthly['rep-a'].ladder.bookings, monthly['rep-a'].total], [23, 2920], 'a month: 23 → 2,500 + 3 × 140');
  await settings.setTenantSetting('bonus_plan', { ...plan, salesPeriod: 'HALF_MONTH' }, { tenantId: T });
  const halves = byId(await bonuses.computeMonthlyBonuses(pool, { tenantId: T, year: 2026, month: 9 }));
  assert.deepEqual(halves['rep-a'].ladder.rounds.map(round => [round.label, round.bookings, round.amount]), [['1–15', 11, 1000], ['16–30', 12, 1000]]);
  assert.equal(halves['rep-a'].total, 2000);
  assert.deepEqual(new Set(halves['rep-a'].bookings.map(booking => booking.round)), new Set(['1–15', '16–30']));
  assert.equal(halves['coll-d'].total, monthly['coll-d'].total, 'a collector is monthly whatever the reps\' period');
  await settings.setTenantSetting('bonus_plan', plan, { tenantId: T });
});
