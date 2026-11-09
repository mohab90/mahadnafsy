'use strict';
/**
 * The owner's changes to a month's bonuses (lib/bonusAdjustments.js, migration 383) on a real MariaDB, and who may make them over HTTP.
 *
 *   course c1 3,000 EGP (1 booking) · c3 12,000 EGP (3 bookings); September 2026, the plan migration 381 seeds, every rep's first target 10
 *   rep A   a1 a2 a3 (c3) and a4 (c1) = 10 → 1,000          rep B   b1 b2 b3 (c3) = 9 → 0
 *   exclude a4 → A 9 → 0 · move a1 to B → A 7 → 0, B 12 → 1,000 · a4 counted as half → A 9.5 → 0 · A's total set to 1,500 with 1,000 computed beside it
 *
 * Who: the owner and an account holding only manage_financial change the plan and the month; HR (view_hr + manage_hr) reads, calculates and saves, and is refused every
 * change to the rules and to the month's figures; a viewer reads; an account with neither is refused everything.
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
const T = 'tenant-bonus-adj-it';
let pool; let bonuses; let adjustments; let app; let who;

let seq = 0;
async function pay({ client, course, amount, staff, day = 10 }) {
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, currency, fx_rate_to_egp, amount_egp, payment_type, status, course_expected, date, payment_method, staff_id, is_installment)
     VALUES (?, ?, ?, ?, ?, 'EGP', 1, ?, 'COURSE', 'paid', ?, ?, 'كاش', ?, 0)`,
    [`pay-adj-${++seq}`, T, client, course, amount, amount, { c1: 3000, c3: 12000 }[course], `2026-09-${String(day).padStart(2, '0')} 12:00:00`, staff]);
  return `pay-adj-${seq}`;
}
const client = (id, rep) => pool.query(
  "INSERT INTO subscribers (id, tenant_id, name, phone, branch, assigned_sales_id) VALUES (?, ?, ?, ?, 'ONLINE_EGYPT', ?)", [id, T, `عميل ${id}`, `10191${String(++seq).padStart(5, '0')}`, rep]);
const staff = (id, scheme = 'SALES_BOOKINGS') => pool.query(
  `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, bonus_scheme, booking_first_target)
   VALUES (?, ?, ?, ?, ?, 'SALES', 1, '2025-01-01', ?, 10)`, [id, T, `موظف ${id}`, `${id}@adj.test`, `10192${String(++seq).padStart(5, '0')}`, scheme]);
const ids = {};

async function clean() {
  for (const table of ['bonus_adjustments', 'employee_bonuses', 'payments', 'client_item_money', 'subscribers', 'courses', 'staff', 'users', 'tenant_settings', 'audit_events', 'tenant_subscriptions']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}
const compute = options => bonuses.computeMonthlyBonuses(pool, { tenantId: T, year: 2026, month: 9, ...options });
const of = (result, id) => result.employees.find(item => item.staffId === id);
const OWNER = { name: 'المالك', id: 'owner-1' };
async function add(input) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const context = await bonuses.adjustmentContext(conn, { tenantId: T, year: 2026, month: 9 });
    const made = await adjustments.addAdjustment(conn, { tenantId: T, year: 2026, month: 9, input, actor: OWNER, context });
    await conn.commit();
    return made;
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}
const revoke = async id => adjustments.revokeAdjustment(pool, { tenantId: T, id, actor: OWNER, reason: 'رجعنا في الكلام' });

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  bonuses = require('../../lib/monthlyBonuses');
  adjustments = require('../../lib/bonusAdjustments');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'Adj IT', 'active')", [T, T]);
  await pool.query("INSERT INTO tenant_subscriptions (id, tenant_id, status, starts_at) VALUES (?, ?, 'active', '2025-01-01')", [`sub-${T}`, T]);
  const seeded = fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '381_v26_bonus_plan.sql'), 'utf8').match(/'bonus_plan', '(\{.*\})', 0/)[1];
  await require('../../lib/tenantSettings').setTenantSetting('bonus_plan', JSON.parse(seeded), { tenantId: T });
  for (const [id, price] of [['c1', 3000], ['c3', 12000]]) {
    await pool.query(
      `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp)
       VALUES (?, ?, ?, '', '', '', '', 'GENERAL', 'RECORDED', ?)`, [id, T, `كورس ${id}`, price]);
  }
  await staff('rep-a'); await staff('rep-b'); await staff('desk-x', 'COLLECTION_BOOKINGS'); await staff('plain', 'NONE');
  for (const [id, course, rep, day] of [['a1', 'c3', 'rep-a', 3], ['a2', 'c3', 'rep-a', 4], ['a3', 'c3', 'rep-a', 5], ['a4', 'c1', 'rep-a', 6],
    ['b1', 'c3', 'rep-b', 7], ['b2', 'c3', 'rep-b', 8], ['b3', 'c3', 'rep-b', 9]]) {
    await client(id, rep);
    ids[id] = await pay({ client: id, course, amount: 1000, staff: rep, day });
  }
  const { startApp, signInStaff } = require('./support/http');
  app = await startApp(pool);
  who = {
    owner: await signInStaff(pool, app, { tenantId: T, id: 'adj-owner', role: 'ADMIN' }),
    financial: await signInStaff(pool, app, { tenantId: T, id: 'adj-fin', role: 'OTHER', permissions: ['manage_financial'] }),
    hr: await signInStaff(pool, app, { tenantId: T, id: 'adj-hr', role: 'HR', permissions: ['view_hr', 'manage_hr'] }),
    viewer: await signInStaff(pool, app, { tenantId: T, id: 'adj-view', role: 'OTHER', permissions: ['view_hr'] }),
    nobody: await signInStaff(pool, app, { tenantId: T, id: 'adj-none', role: 'OTHER', permissions: ['view_dashboard'] }),
  };
});
after(async () => { if (!ENABLED) return; await app.close(); await clean(); await pool.query('DELETE FROM tenants WHERE id=?', [T]).catch(() => {}); await pool.end(); });

test('the system\'s own figures before any change: A 10 → 1,000, B 9 → 0', { skip }, async () => {
  const result = await compute();
  assert.deepEqual([of(result, 'rep-a').ladder.bookings, of(result, 'rep-a').total, of(result, 'rep-b').ladder.bookings, of(result, 'rep-b').total], [10, 1000, 9, 0]);
  assert.deepEqual(result.adjustments, []);
});

test('excluding a booking takes it out of that rep\'s count, shows it, and taking it back restores the figure', { skip }, async () => {
  const made = await add({ kind: 'EXCLUDE_BOOKING', paymentId: ids.a4, reason: 'العميلة اتنقلت لكورس تاني' });
  const a = of(await compute(), 'rep-a');
  assert.deepEqual([a.ladder.bookings, a.total, a.computedTotal], [9, 0, 0]);
  assert.deepEqual(a.excludedBookings.map(item => item.paymentId), [ids.a4]);
  const shown = (await compute()).adjustments;
  assert.deepEqual(shown.map(item => [item.kind, item.staffName, item.client, item.reason, item.by]), [['EXCLUDE_BOOKING', 'موظف rep-a', 'عميل a4', 'العميلة اتنقلت لكورس تاني', 'المالك']]);
  assert.equal((await compute({ applyAdjustments: false })).employees.find(item => item.staffId === 'rep-a').total, 1000, 'the system\'s own figure is still there');
  assert.ok(await revoke(made.id));
  assert.equal(of(await compute(), 'rep-a').total, 1000);
  assert.equal(await revoke(made.id), null, 'taken back once');
  assert.equal((await adjustments.listAdjustments(pool, { tenantId: T, year: 2026, month: 9, history: true })).length, 1, 'the history keeps it');
});

test('moving a booking to another rep: it leaves the first count and joins the second', { skip }, async () => {
  const made = await add({ kind: 'REASSIGN_BOOKING', paymentId: ids.a1, toStaffId: 'rep-b', reason: 'العميل كلّمته سيلز تانية' });
  const result = await compute();
  assert.deepEqual([of(result, 'rep-a').ladder.bookings, of(result, 'rep-a').total, of(result, 'rep-b').ladder.bookings, of(result, 'rep-b').total], [7, 0, 12, 1000]);
  assert.ok(of(result, 'rep-b').bookings.some(item => item.paymentId === ids.a1));
  assert.ok(of(result, 'rep-a').adjustments.includes(made.id) && of(result, 'rep-b').adjustments.includes(made.id), 'both reps\' breakdowns carry it');
  await revoke(made.id);
});

test('a booking counted as half a booking; the total set by hand with the computed figure beside it; a newer change replaces the older', { skip }, async () => {
  const weight = await add({ kind: 'WEIGHT_BOOKING', paymentId: ids.a4, weight: 0.5, reason: 'خصم كبير' });
  let a = of(await compute(), 'rep-a');
  assert.deepEqual([a.ladder.bookings, a.total], [9.5, 0]);
  assert.deepEqual(a.bookings.find(item => item.paymentId === ids.a4).computedWeight, 1);
  await revoke(weight.id);
  await add({ kind: 'TOTAL_OVERRIDE', staffId: 'rep-a', amount: 1200, reason: 'أول مرة' });
  const second = await add({ kind: 'TOTAL_OVERRIDE', staffId: 'rep-a', amount: 1500, reason: 'اتفقنا على مبلغ تاني' });
  const result = await compute();
  a = of(result, 'rep-a');
  assert.deepEqual([a.computedTotal, a.total, a.override.amount, a.override.reason, a.override.by], [1000, 1500, 1500, 'اتفقنا على مبلغ تاني', 'المالك']);
  assert.match(a.summary, /تعديل يدوي: الإجمالي 1500 بدل 1000/);
  assert.equal(result.total, 1500 + 0, 'the month\'s total is the adjusted one');
  assert.equal(result.computedTotal, 1000);
  assert.equal(result.adjustments.length, 1, 'one live total for A');
  assert.equal((await adjustments.listAdjustments(pool, { tenantId: T, year: 2026, month: 9, history: true })).filter(item => item.kind === 'TOTAL_OVERRIDE').length, 2, 'the replaced one stays in the history');
  assert.equal(second.amount, 1500);
});

test('saving writes the adjusted figure awaiting approval, with the reason; an approved one is kept and the new figure said', { skip }, async () => {
  const save = async () => {
    const conn = await pool.getConnection();
    try { await conn.beginTransaction(); const result = await bonuses.saveMonthlyBonuses(conn, { tenantId: T, year: 2026, month: 9 }); await conn.commit(); return result; } finally { conn.release(); }
  };
  const first = await save();
  assert.deepEqual(first.written.map(item => [item.staffId, item.amount]), [['rep-a', 1500]]);
  const [[row]] = await pool.query("SELECT amount, status, reason, calc_json FROM employee_bonuses WHERE tenant_id=? AND staff_id='rep-a' AND source='BONUS_PLAN'", [T]);
  assert.deepEqual([Number(row.amount), row.status], [1500, 'PENDING']);
  assert.match(row.reason, /اتفقنا على مبلغ تاني/);
  const calc = JSON.parse(row.calc_json);
  assert.deepEqual([calc.computedTotal, calc.override.amount], [1000, 1500]);
  await pool.query("UPDATE employee_bonuses SET status='APPROVED' WHERE tenant_id=? AND staff_id='rep-a'", [T]);
  const live = (await adjustments.listAdjustments(pool, { tenantId: T, year: 2026, month: 9 })).find(item => item.kind === 'TOTAL_OVERRIDE');
  await revoke(live.id);
  const second = await save();
  assert.deepEqual(second.kept.map(item => [item.staffId, item.status, item.amount, item.now]), [['rep-a', 'APPROVED', 1500, 1000]]);
});

test('a change is refused without a reason, outside the month, for a rep not on the scheme, or of an unknown kind', { skip }, async () => {
  const refused = async (input, pattern) => assert.rejects(() => add(input), error => error.statusCode === 400 && pattern.test(error.message));
  await refused({ kind: 'EXCLUDE_BOOKING', paymentId: ids.a4, reason: '  ' }, /سبب/);
  await refused({ kind: 'EXCLUDE_BOOKING', paymentId: 'pay-nope', reason: 'سبب' }, /مش من حجوزات الشهر/);
  await refused({ kind: 'REASSIGN_BOOKING', paymentId: ids.a4, toStaffId: 'plain', reason: 'سبب' }, /حجوزات \(سيلز\)/);
  await refused({ kind: 'REASSIGN_BOOKING', paymentId: ids.a4, toStaffId: 'desk-x', reason: 'سبب' }, /حجوزات \(سيلز\)/);
  await refused({ kind: 'REASSIGN_BOOKING', paymentId: ids.a4, toStaffId: 'rep-a', reason: 'سبب' }, /أصلا على السيلز ده/);
  await refused({ kind: 'TOTAL_OVERRIDE', staffId: 'plain', amount: 100, reason: 'سبب' }, /مش على نظام المكافآت/);
  await refused({ kind: 'TOTAL_OVERRIDE', staffId: 'rep-a', amount: -5, reason: 'سبب' }, /المبلغ/);
  await refused({ kind: 'WEIGHT_BOOKING', paymentId: ids.a4, weight: 99, reason: 'سبب' }, /عدد الحجوزات/);
  await refused({ kind: 'DELETE_EVERYTHING', reason: 'سبب' }, /نوع التعديل/);
});

// ───────────── who may do what, over HTTP ─────────────

const bonusPlanBody = async () => (await app.call('GET', '/api/admin/hr/bonus-plan', { session: who.owner })).body.plan;

test('the owner changes the plan, and a change to a month: with a reason, the month shows it, the audit trail has it', { skip }, async () => {
  const plan = await bonusPlanBody();
  const put = await app.call('PUT', '/api/admin/hr/bonus-plan', { session: who.owner, body: { plan: { ...plan, courseSalesBonusEnabled: false } } });
  assert.equal(put.status, 200, put.text);
  const noReason = await app.call('POST', '/api/admin/hr/bonus-adjustments', { session: who.owner, body: { month: '2026-09', kind: 'EXCLUDE_BOOKING', paymentId: ids.a4 } });
  assert.equal(noReason.status, 400);
  const made = await app.call('POST', '/api/admin/hr/bonus-adjustments', { session: who.owner, body: { month: '2026-09', kind: 'WEIGHT_BOOKING', paymentId: ids.b1, weight: 1, reason: 'سعر خاص' } });
  assert.equal(made.status, 200, made.text);
  const month = await app.call('GET', '/api/admin/hr/monthly-bonuses?month=2026-09', { session: who.owner });
  assert.deepEqual(month.body.adjustments.map(item => [item.kind, item.by, item.reason]), [['WEIGHT_BOOKING', 'adj-owner', 'سعر خاص']]);
  assert.equal(month.body.employees.find(item => item.staffId === 'rep-b').ladder.bookings, 7);
  const list = await app.call('GET', '/api/admin/hr/bonus-adjustments?month=2026-09', { session: who.owner });
  assert.equal(list.body.adjustments.length, 1);
  const undone = await app.call('POST', `/api/admin/hr/bonus-adjustments/${made.body.adjustment.id}/revoke`, { session: who.owner, body: { reason: 'غلط' } });
  assert.equal(undone.status, 200);
  assert.equal((await app.call('POST', `/api/admin/hr/bonus-adjustments/${made.body.adjustment.id}/revoke`, { session: who.owner, body: {} })).status, 404);
  const [[audit]] = await pool.query("SELECT COUNT(*) AS n FROM audit_events WHERE tenant_id=? AND action IN ('hr.bonus_adjusted','hr.bonus_adjustment_revoked','hr.bonus_plan_saved')", [T]);
  assert.ok(Number(audit.n) >= 3, 'the plan, the change and taking it back are in the audit trail');
});

test('an account holding only manage_financial changes the plan and the month, and uploads the sales sheet', { skip }, async () => {
  const plan = await bonusPlanBody();
  assert.equal((await app.call('PUT', '/api/admin/hr/bonus-plan', { session: who.financial, body: { plan } })).status, 200);
  const made = await app.call('POST', '/api/admin/hr/bonus-adjustments', { session: who.financial, body: { month: '2026-09', kind: 'TOTAL_OVERRIDE', staffId: 'rep-b', amount: 700, reason: 'اتفاق شخصي' } });
  assert.equal(made.status, 200, made.text);
  assert.equal((await app.call('POST', `/api/admin/hr/bonus-adjustments/${made.body.adjustment.id}/revoke`, { session: who.financial, body: {} })).status, 200);
  const upload = await app.call('POST', '/api/admin/hr/sales-sheet-reconciliation', { session: who.financial, body: { month: '2026-09' } });
  assert.equal(upload.status, 400, 'allowed in, and asked for the file');
  const notAWorkbook = await app.call('POST', '/api/admin/hr/sales-sheet-reconciliation', { session: who.financial, body: { month: '2026-09', fileBase64: Buffer.from('not a workbook').toString('base64') } });
  assert.equal(notAWorkbook.status, 400);
  assert.match(notAWorkbook.body.error, /Excel/);
});

test('HR reads, calculates and saves, and is refused every change to the rules and to the month\'s figures', { skip }, async () => {
  const plan = await bonusPlanBody();
  assert.equal((await app.call('GET', '/api/admin/hr/bonus-plan', { session: who.hr })).status, 200);
  assert.equal((await app.call('GET', '/api/admin/hr/monthly-bonuses?month=2026-09', { session: who.hr })).status, 200);
  assert.equal((await app.call('GET', '/api/admin/hr/bonus-adjustments?month=2026-09', { session: who.hr })).status, 200);
  assert.equal((await app.call('POST', '/api/admin/hr/monthly-bonuses', { session: who.hr, body: { month: '2026-09' } })).status, 200);
  assert.equal((await app.call('PUT', '/api/admin/hr/bonus-plan', { session: who.hr, body: { plan } })).status, 403);
  const attempt = { month: '2026-09', kind: 'EXCLUDE_BOOKING', paymentId: ids.a4, reason: 'سبب' };
  assert.equal((await app.call('POST', '/api/admin/hr/bonus-adjustments', { session: who.hr, body: attempt })).status, 403);
  assert.equal((await app.call('POST', '/api/admin/hr/bonus-adjustments/x/revoke', { session: who.hr, body: {} })).status, 403);
  assert.equal((await app.call('POST', '/api/admin/hr/sales-sheet-reconciliation', { session: who.hr, body: { month: '2026-09' } })).status, 403);
});

test('a viewer reads and nothing else; an account with neither permission is refused everything', { skip }, async () => {
  const plan = await bonusPlanBody();
  assert.equal((await app.call('GET', '/api/admin/hr/monthly-bonuses?month=2026-09', { session: who.viewer })).status, 200);
  assert.equal((await app.call('POST', '/api/admin/hr/monthly-bonuses', { session: who.viewer, body: { month: '2026-09' } })).status, 403);
  assert.equal((await app.call('PUT', '/api/admin/hr/bonus-plan', { session: who.viewer, body: { plan } })).status, 403);
  assert.equal((await app.call('POST', '/api/admin/hr/bonus-adjustments', { session: who.viewer, body: { month: '2026-09', kind: 'TOTAL_OVERRIDE', staffId: 'rep-a', amount: 1, reason: 'سبب' } })).status, 403);
  for (const [method, url] of [['GET', '/api/admin/hr/bonus-plan'], ['GET', '/api/admin/hr/monthly-bonuses?month=2026-09'], ['GET', '/api/admin/hr/bonus-adjustments?month=2026-09']]) {
    assert.equal((await app.call(method, url, { session: who.nobody })).status, 403, url);
  }
  assert.equal((await app.call('PUT', '/api/admin/hr/bonus-plan', { session: who.nobody, body: { plan } })).status, 403);
  assert.equal((await app.call('GET', '/api/admin/hr/bonus-plan')).status, 401, 'signed out');
});
