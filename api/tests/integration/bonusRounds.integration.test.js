'use strict';
/**
 * The owner's two new changes on the half-month rounds (lib/bonusAdjustments.js, migration 384), on a real MariaDB.
 *
 *   ROUND_OVERRIDE   one round's bonus of a rep is the owner's figure, the plan's stays beside it, a reason is required, revocable
 *   COUNT_IN_MONTH   a booking paid in the month after (or before) counts in THIS month for a rep and not in its own — and no payment is touched
 *
 *   September 2026, the plan migration 381 seeds with half-month rounds; c1 = 3,000 EGP (1 booking), c3 = 12,000 EGP (3 bookings); every rep's first target 10
 *   rep A  round 1: a1 a2 a3 (c3) + a4 (c1) = 10 → 1,000     round 2: a5 (c3) = 3 → 0
 *   rep B  round 1: b1 b2 b3 (c3) = 9 → 0
 *   late   l1 (c3, rep A) paid 2 Oct and m1 (c3, rep B) paid 30 Aug
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
const T = 'tenant-bonus-rounds-it';
let pool; let bonuses; let adjustments; let app; let who;

let seq = 0;
async function pay({ client, course, staff, date }) {
  const id = `pay-rnd-${++seq}`;
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, currency, fx_rate_to_egp, amount_egp, payment_type, status, course_expected, date, payment_method, staff_id, is_installment)
     VALUES (?, ?, ?, ?, 1000, 'EGP', 1, 1000, 'COURSE', 'paid', ?, ?, 'كاش', ?, 0)`,
    [id, T, client, course, { c1: 3000, c3: 12000 }[course], `${date} 12:00:00`, staff]);
  return id;
}
const client = (id, rep) => pool.query(
  "INSERT INTO subscribers (id, tenant_id, name, phone, branch, assigned_sales_id) VALUES (?, ?, ?, ?, 'ONLINE_EGYPT', ?)", [id, T, `عميل ${id}`, `10171${String(++seq).padStart(5, '0')}`, rep]);
const staff = (id, scheme = 'SALES_BOOKINGS') => pool.query(
  `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, bonus_scheme, booking_first_target)
   VALUES (?, ?, ?, ?, ?, 'SALES', 1, '2025-01-01', ?, 10)`, [id, T, `موظف ${id}`, `${id}@rnd.test`, `10172${String(++seq).padStart(5, '0')}`, scheme]);
const ids = {};

async function clean() {
  for (const table of ['bonus_adjustments', 'employee_bonuses', 'payments', 'client_item_money', 'subscribers', 'courses', 'staff', 'users', 'tenant_settings', 'audit_logs', 'tenant_subscriptions']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}
const compute = (month = 9, options = {}) => bonuses.computeMonthlyBonuses(pool, { tenantId: T, year: 2026, month, ...options });
const of = (result, id) => result.employees.find(item => item.staffId === id);
const OWNER = { name: 'المالك', id: 'owner-1' };
async function add(input, month = 9) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const context = await bonuses.adjustmentContext(conn, { tenantId: T, year: 2026, month });
    const made = await adjustments.addAdjustment(conn, { tenantId: T, year: 2026, month, input, actor: OWNER, context });
    await conn.commit();
    return made;
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}
const revoke = id => adjustments.revokeAdjustment(pool, { tenantId: T, id, actor: OWNER, reason: 'رجعنا في الكلام' });
const roundsOf = employee => employee.ladder.rounds.map(round => [round.label, round.bookings, round.amount]);

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  bonuses = require('../../lib/monthlyBonuses');
  adjustments = require('../../lib/bonusAdjustments');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'Rounds IT', 'active')", [T, T]);
  await pool.query("INSERT INTO tenant_subscriptions (id, tenant_id, status, starts_at) VALUES (?, ?, 'active', '2025-01-01')", [`sub-${T}`, T]);
  const seeded = fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '381_v26_bonus_plan.sql'), 'utf8').match(/'bonus_plan', '(\{.*\})', 0/)[1];
  await require('../../lib/tenantSettings').setTenantSetting('bonus_plan', { ...JSON.parse(seeded), salesPeriod: 'HALF_MONTH' }, { tenantId: T });
  for (const [id, price] of [['c1', 3000], ['c3', 12000]]) {
    await pool.query(
      `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp)
       VALUES (?, ?, ?, '', '', '', '', 'GENERAL', 'RECORDED', ?)`, [id, T, `كورس ${id}`, price]);
  }
  await staff('rep-a'); await staff('rep-b'); await staff('desk-x', 'COLLECTION_BOOKINGS'); await staff('plain', 'NONE');
  for (const [id, course, rep, date] of [['a1', 'c3', 'rep-a', '2026-09-03'], ['a2', 'c3', 'rep-a', '2026-09-04'], ['a3', 'c3', 'rep-a', '2026-09-05'], ['a4', 'c1', 'rep-a', '2026-09-06'],
    ['a5', 'c3', 'rep-a', '2026-09-20'], ['b1', 'c3', 'rep-b', '2026-09-07'], ['b2', 'c3', 'rep-b', '2026-09-08'], ['b3', 'c3', 'rep-b', '2026-09-09'],
    ['l1', 'c3', 'rep-a', '2026-10-02'], ['m1', 'c3', 'rep-b', '2026-08-30']]) {
    await client(id, rep);
    ids[id] = await pay({ client: id, course, staff: rep, date });
  }
  const { startApp, signInStaff } = require('./support/http');
  app = await startApp(pool);
  who = {
    owner: await signInStaff(pool, app, { tenantId: T, id: 'rnd-owner', role: 'ADMIN' }),
    financial: await signInStaff(pool, app, { tenantId: T, id: 'rnd-fin', role: 'OTHER', permissions: ['manage_financial'] }),
    hr: await signInStaff(pool, app, { tenantId: T, id: 'rnd-hr', role: 'HR', permissions: ['view_hr', 'manage_hr'] }),
  };
});
after(async () => { if (!ENABLED) return; await app.close(); await clean(); await pool.query('DELETE FROM tenants WHERE id=?', [T]).catch(() => {}); await pool.end(); });

test('the plan\'s own rounds before any change: A 10 → 1,000 then 3 → 0; B 9 → 0', { skip }, async () => {
  const result = await compute();
  assert.deepEqual(roundsOf(of(result, 'rep-a')), [['1–15', 10, 1000], ['16–30', 3, 0]]);
  assert.deepEqual(roundsOf(of(result, 'rep-b')), [['1–15', 9, 0], ['16–30', 0, 0]]);
  const [first, second] = of(result, 'rep-a').ladder.rounds;
  assert.deepEqual([first.round, first.from, first.to, second.round, second.from, second.to], [1, '2026-09-01', '2026-09-15', 2, '2026-09-16', '2026-09-30']);
});

test('one round\'s bonus set by hand: the plan\'s figure stays beside it, the total follows, a newer one replaces the older, taking it back restores the plan', { skip }, async () => {
  const first = await add({ kind: 'ROUND_OVERRIDE', staffId: 'rep-b', round: 1, amount: 700, reason: 'اتفاق شخصي' });
  let b = of(await compute(), 'rep-b');
  const [round1, round2] = b.ladder.rounds;
  assert.deepEqual([round1.amount, round1.computedAmount, round1.override.amount, round1.override.reason, round1.override.by], [700, 0, 700, 'اتفاق شخصي', 'المالك']);
  assert.equal(round2.override, undefined, 'the other round is the plan\'s');
  assert.deepEqual([b.ladder.amount, b.computedTotal, b.total], [700, 700, 700]);
  assert.match(b.summary, /1–15: 9 حجز ← 700 \(تعديل يدوي بدل 0\)/);
  assert.equal((await compute(9, { applyAdjustments: false })).employees.find(item => item.staffId === 'rep-b').total, 0, 'the plan\'s own figure is still there');

  await add({ kind: 'ROUND_OVERRIDE', staffId: 'rep-b', round: 1, amount: 900, reason: 'اتفقنا على مبلغ تاني' });
  await add({ kind: 'ROUND_OVERRIDE', staffId: 'rep-b', round: 2, amount: 300, reason: 'الروند التاني' });
  b = of(await compute(), 'rep-b');
  assert.deepEqual(b.ladder.rounds.map(round => round.amount), [900, 300]);
  assert.equal(b.total, 1200);
  const live = (await compute()).adjustments.filter(item => item.kind === 'ROUND_OVERRIDE');
  assert.deepEqual(live.map(item => [item.round, item.amount]), [[1, 900], [2, 300]]);
  assert.equal((await adjustments.listAdjustments(pool, { tenantId: T, year: 2026, month: 9, history: true })).filter(item => item.kind === 'ROUND_OVERRIDE').length, 3, 'the replaced one stays in the history');

  // a total set by hand still wins over the rounds
  const total = await add({ kind: 'TOTAL_OVERRIDE', staffId: 'rep-b', amount: 2000, reason: 'اجمالي' });
  b = of(await compute(), 'rep-b');
  assert.deepEqual([b.computedTotal, b.total], [1200, 2000]);
  await revoke(total.id);
  for (const item of live) await revoke(item.id);
  assert.ok(first.id);
  b = of(await compute(), 'rep-b');
  assert.deepEqual([b.total, b.ladder.rounds.map(round => round.override)], [0, [undefined, undefined]]);
});

test('a round change needs a reason, a round of 1 or 2, a sum, and a rep on the booking scheme', { skip }, async () => {
  const refused = async (input, pattern) => assert.rejects(() => add({ kind: 'ROUND_OVERRIDE', ...input }), error => error.statusCode === 400 && pattern.test(error.message));
  await refused({ staffId: 'rep-a', round: 1, amount: 100, reason: ' ' }, /سبب/);
  await refused({ staffId: 'rep-a', round: 3, amount: 100, reason: 'سبب' }, /الروند/);
  await refused({ staffId: 'rep-a', round: 1, amount: -5, reason: 'سبب' }, /المبلغ/);
  await refused({ staffId: 'rep-a', round: 1, reason: 'سبب' }, /المبلغ/);
  await refused({ staffId: 'desk-x', round: 1, amount: 5, reason: 'سبب' }, /حجوزات \(سيلز\)/);
  await refused({ staffId: 'plain', round: 1, amount: 5, reason: 'سبب' }, /حجوزات \(سيلز\)/);
});

test('a booking paid in October counts in September for rep A (round 2, on the last day) and not in October; no payment changes', { skip }, async () => {
  const before = (await pool.query('SELECT id, date, amount, amount_egp, status, staff_id, subscriber_id FROM payments WHERE tenant_id=? ORDER BY id', [T]))[0];
  assert.deepEqual(roundsOf(of(await compute(10), 'rep-a')), [['1–15', 3, 0], ['16–31', 0, 0]], 'October: l1 is its own, 3 bookings');
  const made = await add({ kind: 'COUNT_IN_MONTH', staffId: 'rep-a', paymentId: ids.l1, reason: 'اترفع متأخر' });
  assert.equal(made.paymentId, ids.l1);

  const september = await compute(9);
  const a = of(september, 'rep-a');
  assert.deepEqual(roundsOf(a), [['1–15', 10, 1000], ['16–30', 6, 0]], 'l1 (3 bookings) joins round 2');
  const moved = a.bookings.find(item => item.paymentId === ids.l1);
  assert.deepEqual([moved.movedIn.paidDay, moved.day, moved.round], ['2026-10-02', '2026-09-30', '16–30']);
  assert.deepEqual(september.adjustments.map(item => [item.kind, item.staffName, item.client, item.reason, item.by]), [['COUNT_IN_MONTH', 'موظف rep-a', 'عميل l1', 'اترفع متأخر', 'المالك']]);

  const october = await compute(10);
  assert.deepEqual(roundsOf(of(october, 'rep-a')), [['1–15', 0, 0], ['16–31', 0, 0]], 'and not in October');
  assert.deepEqual(october.movedOut.map(item => [item.paymentId, item.countedElsewhere.month, item.staffName]), [[ids.l1, '2026-09', 'موظف rep-a']]);

  const after = (await pool.query('SELECT id, date, amount, amount_egp, status, staff_id, subscriber_id FROM payments WHERE tenant_id=? ORDER BY id', [T]))[0];
  assert.deepEqual(after, before, 'not one payment row changed');

  assert.ok(await revoke(made.id));
  assert.deepEqual(roundsOf(of(await compute(9), 'rep-a')), [['1–15', 10, 1000], ['16–30', 3, 0]]);
  assert.deepEqual(roundsOf(of(await compute(10), 'rep-a')), [['1–15', 3, 0], ['16–31', 0, 0]], 'taken back: October has it again');
});

test('a booking paid in August counts in September for rep B on the first day (round 1)', { skip }, async () => {
  const made = await add({ kind: 'COUNT_IN_MONTH', staffId: 'rep-b', paymentId: ids.m1, reason: 'اترفع متأخر من أغسطس' });
  const september = await compute(9);
  const b = of(september, 'rep-b');
  assert.deepEqual(roundsOf(b), [['1–15', 12, 1000], ['16–30', 0, 0]]);
  const moved = b.bookings.find(item => item.paymentId === ids.m1);
  assert.deepEqual([moved.movedIn.paidDay, moved.day], ['2026-08-30', '2026-09-01']);
  assert.deepEqual(roundsOf(of(await compute(8), 'rep-b')).flat().slice(1, 3), [0, 0], 'August no longer counts it for rep B');
  await revoke(made.id);
  assert.equal(of(await compute(9), 'rep-b').total, 0);
});

test('moving a late booking again replaces the older move, whichever month it was for; a month apart or a wrong rep is refused', { skip }, async () => {
  const toSeptember = await add({ kind: 'COUNT_IN_MONTH', staffId: 'rep-a', paymentId: ids.l1, reason: 'أول مرة' });
  // l1 (October) can only be counted in September or November
  const toNovember = await add({ kind: 'COUNT_IN_MONTH', staffId: 'rep-b', paymentId: ids.l1, reason: 'غيرنا رأينا' }, 11);
  const live = await adjustments.listAdjustments(pool, { tenantId: T, year: 2026, month: 9 });
  assert.equal(live.filter(item => item.kind === 'COUNT_IN_MONTH').length, 0, 'September\'s move was replaced');
  assert.equal((await adjustments.listAdjustments(pool, { tenantId: T, year: 2026, month: 11 })).length, 1);
  assert.equal(of(await compute(11), 'rep-b').ladder.bookings, 3);
  assert.equal(of(await compute(10), 'rep-a').ladder.bookings, 0, 'October still does not count it');
  await revoke(toNovember.id);
  assert.ok(toSeptember.id);

  const refused = async (input, pattern, month = 9) => assert.rejects(() => add({ kind: 'COUNT_IN_MONTH', ...input }, month), error => error.statusCode === 400 && pattern.test(error.message));
  await refused({ staffId: 'rep-a', paymentId: ids.a1, reason: 'سبب' }, /أصلا من حجوزات الشهر ده/);
  await refused({ staffId: 'rep-a', paymentId: ids.l1, reason: ' ' }, /سبب/);
  await refused({ staffId: 'rep-a', paymentId: ids.l1, reason: 'سبب' }, /قبل الشهر ده أو اللي بعده/, 12);
  await refused({ staffId: 'desk-x', paymentId: ids.l1, reason: 'سبب' }, /حجوزات \(سيلز\)/);
  await refused({ staffId: 'plain', paymentId: ids.l1, reason: 'سبب' }, /حجوزات \(سيلز\)/);
  await refused({ staffId: 'rep-a', paymentId: 'pay-nope', reason: 'سبب' }, /قبل الشهر ده أو اللي بعده/);
});

test('a late booking counted elsewhere stays the desk\'s in its own month, and an instalment is not a booking to move', { skip }, async () => {
  await staff('desk-y', 'COLLECTION_BOOKINGS');
  await pool.query("UPDATE payments SET staff_id='desk-y' WHERE id=?", [ids.l1]);
  const made = await add({ kind: 'COUNT_IN_MONTH', staffId: 'rep-a', paymentId: ids.l1, reason: 'اترفع متأخر' });
  const october = await compute(10);
  assert.equal(of(october, 'desk-y').bookings.some(item => item.paymentId === ids.l1), true, 'the desk keeps it in October');
  assert.equal(of(await compute(9), 'desk-y').bookings.length, 0, 'and September does not give it to the desk');
  await revoke(made.id);
  // a second payment of the same client for the same course is not a booking
  const second = await pay({ client: 'l1', course: 'c3', staff: 'rep-a', date: '2026-10-20' });
  await assert.rejects(() => add({ kind: 'COUNT_IN_MONTH', staffId: 'rep-a', paymentId: second, reason: 'سبب' }), error => error.statusCode === 400);
});

// ───────────── who may do it, over HTTP ─────────────

test('the owner and manage_financial make both changes and take them back; HR is refused', { skip }, async () => {
  const roundBody = { month: '2026-09', kind: 'ROUND_OVERRIDE', staffId: 'rep-a', round: 2, amount: 400, reason: 'تقدير من المالك' };
  assert.equal((await app.call('POST', '/api/admin/hr/bonus-adjustments', { session: who.hr, body: roundBody })).status, 403);
  const countBody = { month: '2026-09', kind: 'COUNT_IN_MONTH', staffId: 'rep-a', paymentId: ids.l1, reason: 'اترفع متأخر' };
  assert.equal((await app.call('POST', '/api/admin/hr/bonus-adjustments', { session: who.hr, body: countBody })).status, 403);
  const round = await app.call('POST', '/api/admin/hr/bonus-adjustments', { session: who.financial, body: roundBody });
  assert.equal(round.status, 200, round.text);
  const count = await app.call('POST', '/api/admin/hr/bonus-adjustments', { session: who.owner, body: countBody });
  assert.equal(count.status, 200, count.text);
  const month = await app.call('GET', '/api/admin/hr/monthly-bonuses?month=2026-09', { session: who.hr });
  assert.deepEqual(month.body.employees.find(item => item.staffId === 'rep-a').ladder.rounds.map(item => item.amount), [1000, 400]);
  assert.deepEqual(month.body.adjustments.map(item => item.kind).sort(), ['COUNT_IN_MONTH', 'ROUND_OVERRIDE']);
  const noReason = await app.call('POST', '/api/admin/hr/bonus-adjustments', { session: who.owner, body: { ...roundBody, reason: '' } });
  assert.equal(noReason.status, 400);
  for (const made of [round, count]) {
    assert.equal((await app.call('POST', `/api/admin/hr/bonus-adjustments/${made.body.adjustment.id}/revoke`, { session: who.financial, body: { reason: 'غلط' } })).status, 200);
  }
  const [[audit]] = await pool.query("SELECT COUNT(*) AS n FROM audit_logs WHERE tenant_id=? AND action IN ('hr.bonus_adjusted','hr.bonus_adjustment_revoked')", [T]);
  assert.ok(Number(audit.n) >= 4, 'both changes and both withdrawals are in the audit trail');
});

test('saving writes the rounds of a rep, the owner\'s round figure and its reason into the pending bonus', { skip }, async () => {
  await add({ kind: 'ROUND_OVERRIDE', staffId: 'rep-a', round: 2, amount: 400, reason: 'تقدير من المالك' });
  const conn = await pool.getConnection();
  try { await conn.beginTransaction(); await bonuses.saveMonthlyBonuses(conn, { tenantId: T, year: 2026, month: 9 }); await conn.commit(); } finally { conn.release(); }
  const [[row]] = await pool.query("SELECT amount, status, reason, calc_json FROM employee_bonuses WHERE tenant_id=? AND staff_id='rep-a' AND source='BONUS_PLAN'", [T]);
  assert.deepEqual([Number(row.amount), row.status], [1400, 'PENDING']);
  const calc = typeof row.calc_json === 'string' ? JSON.parse(row.calc_json) : row.calc_json;
  assert.deepEqual(calc.ladder.rounds.map(item => [item.label, item.amount, item.computedAmount ?? null, item.override?.reason ?? null]), [['1–15', 1000, null, null], ['16–30', 400, 0, 'تقدير من المالك']]);
});
