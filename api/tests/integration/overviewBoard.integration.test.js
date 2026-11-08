'use strict';
/**
 * «نظرة عامة»'s board (GET /api/admin/overview/board, api/lib/overviewBoard.js) over HTTP on the real app and a real MariaDB, against a ledger small enough to add up
 * by hand: today, yesterday and the same weekday last week for the leads, the bookings, the money (course money and certificate money apart), the expenses and the net;
 * hidden, deleted, pending and another tenant's rows left out; the alerts (overdue instalments, leads with no follow-up date, collection below its pace, slow
 * endpoints); and who may read it (admin, a ticked account with the whole institute's reach — not sales, not a branch manager). Runs only with DB_* (or TEST_DB_*).
 *
 * The ledger (Cairo days, rows placed at noon):
 *   leads     today 3 (+1 hidden, +1 deleted)   yesterday 2   last week 1      — five open ones have no follow-up date, one has
 *   money     today: booking 1000, instalment 500, certificate 300, pending 999 (not money), deleted 888 (not money)
 *             yesterday: booking 800        last week: bookings 600 and 400
 *   expenses  today 200 EGP          yesterday 100 SAR stored as 500 EGP       last week 50 EGP
 *   net       today 1300             yesterday 300                             last week 950
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
const skip = !ENABLED && 'no DB_* configured';
const { startApp, signInStaff, ensureTenant } = require('./support/http');
const { cairoToday, cairoDayStartUtc, addDaysToDateOnly } = require('../../lib/dates');

const T = 'tenant-board-it';
const OTHER = 'tenant-board-it-other';
let pool; let app; let admin; let sales; let ticked; let branchManager;

const noon = offset => new Date(new Date(cairoDayStartUtc(addDaysToDateOnly(cairoToday(), offset))).getTime() + 12 * 3600 * 1000);
let seq = 0;
const lead = (offset, extra = {}) => pool.query(
  'INSERT INTO leads (id, tenant_id, name, phone, source, status, hidden, deleted_at, next_follow_up_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  [`ld-bd-${++seq}`, extra.tenant || T, 'ليد', `0105${String(seq).padStart(7, '0')}`, 'فيسبوك', 'new', extra.hidden || 0, extra.deleted ? new Date() : null, extra.followUp || null, noon(offset)]);
const payment = (offset, amount, extra = {}) => pool.query(
  `INSERT INTO payments (id, tenant_id, subscriber_id, date, amount, currency, fx_rate_to_egp, amount_egp, payment_type, course_id, status, branch, payment_method, is_installment, deleted_at)
   VALUES (?, ?, 'sub-bd-1', ?, ?, 'EGP', 1, ?, ?, 'co-bd-1', ?, 'ONLINE_EGYPT', 'كاش', ?, ?)`,
  [`pay-bd-${++seq}`, extra.tenant || T, noon(offset), amount, amount, extra.type || 'COURSE', extra.status || 'paid', extra.installment ? 1 : 0, extra.deleted ? new Date() : null]);
const expense = (offset, amount, extra = {}) => pool.query(
  "INSERT INTO expenses (id, tenant_id, branch_id, date, description, amount, currency, amount_egp, category, created_at) VALUES (?, ?, 'branch-other', ?, 'مصروف', ?, ?, ?, 'Other', NOW())",
  [`ex-bd-${++seq}`, T, noon(offset), amount, extra.currency || 'EGP', extra.egp ?? null]);
const board = session => app.call('GET', '/api/admin/overview/board', { session });

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await ensureTenant(pool, T);
  await ensureTenant(pool, OTHER);
  app = await startApp(pool);
  admin = await signInStaff(pool, app, { tenantId: T, id: 'st-bd-admin', role: 'ADMIN', name: 'المدير' });
  sales = await signInStaff(pool, app, { tenantId: T, id: 'st-bd-sales', role: 'SALES' });
  ticked = await signInStaff(pool, app, { tenantId: T, id: 'st-bd-ticked', role: 'SALES', permissions: ['view_dashboard', 'view_financial'], dataScope: 'all' });
  branchManager = await signInStaff(pool, app, { tenantId: T, id: 'st-bd-bm', role: 'DAQQI_MANAGER', dataScope: 'branch:DAQQI' });
  await pool.query("INSERT INTO courses (id, tenant_id, slug, title, description, short_description, instructor, thumbnail, category, type) VALUES ('co-bd-1', ?, 'co-bd-1', 'دورة', '', '', '', '', 'GENERAL', 'RECORDED')", [T]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, branch) VALUES ('sub-bd-1', ?, 'عميل', '1018100001', 'ONLINE_EGYPT')", [T]);
  for (const [offset, extra] of [[0, {}], [0, {}], [0, { followUp: cairoToday() }], [0, { hidden: 1 }], [0, { deleted: true }], [-1, {}], [-1, {}], [-7, {}]]) await lead(offset, extra);
  await lead(0, { tenant: OTHER });
  await payment(0, 1000); await payment(0, 500, { installment: true }); await payment(0, 300, { type: 'CERTIFICATE' });
  await payment(0, 999, { status: 'pending' }); await payment(0, 888, { deleted: true }); await payment(0, 7777, { tenant: OTHER });
  await payment(-1, 800); await payment(-7, 600); await payment(-7, 400);
  await expense(0, 200); await expense(-1, 100, { currency: 'SAR', egp: 500 }); await expense(-7, 50);
  for (const [i, [due, paid, sub]] of [[-1, 0, 'a'], [-3, 0, 'b'], [-3, 1, 'c'], [5, 0, 'd']].entries()) {
    await pool.query('INSERT INTO installment_entries (id, plan_id, tenant_id, seq, due_date, amount, paid, subscriber_id) VALUES (?, ?, ?, 0, ?, 100, ?, ?)',
      [`ie-bd-${i}`, `plan-bd-${i}`, T, addDaysToDateOnly(cairoToday(), due), paid, sub]);
  }
  const perf = require('../../lib/performanceMonitor');
  for (let i = 0; i < 6; i++) perf.recordRequest({ method: 'GET', route: '/api/admin/slow-thing', status: 200, ms: 3000, bytes: 10 });
});

after(async () => {
  if (!ENABLED) return;
  if (app) await app.close();
  await pool.end().catch(() => {});
});

test('today, yesterday and the same weekday last week add up to the ledger, hidden, deleted, pending and other tenants\' rows left out', { skip }, async () => {
  const res = await board(admin);
  assert.equal(res.status, 200, res.text);
  const { today, yesterday, lastWeek } = res.body.periods;
  assert.deepEqual({ ...today, day: undefined }, { day: undefined, leads: 3, bookings: 1, courseMoney: 1500, certificateMoney: 300, expenses: 200, net: 1300 });
  assert.deepEqual({ ...yesterday, day: undefined }, { day: undefined, leads: 2, bookings: 1, courseMoney: 800, certificateMoney: 0, expenses: 500, net: 300 });
  assert.deepEqual({ ...lastWeek, day: undefined }, { day: undefined, leads: 1, bookings: 2, courseMoney: 1000, certificateMoney: 0, expenses: 50, net: 950 });
  assert.equal(today.day, cairoToday());
  assert.equal(lastWeek.day, addDaysToDateOnly(cairoToday(), -7));
});

test('the alerts: overdue instalments, open leads with no follow-up date, the collection against its pace', { skip }, async () => {
  const { alerts } = (await board(admin)).body;
  assert.deepEqual(alerts.overdueInstallments, { count: 2, clients: 2 });
  assert.equal(alerts.leadsWithoutFollowUp.count, 5);
  assert.ok(alerts.collection.collected >= 1500);
  // No target set: the default 160,000 a month, far above the day's pace of what this ledger collected.
  assert.equal(alerts.collection.target, 160000);
  await pool.query("INSERT INTO sales_targets (tenant_id, staff_id, period, revenue_target) VALUES (?, '__collection__', ?, 1) ON DUPLICATE KEY UPDATE revenue_target=1", [T, cairoToday().slice(0, 7)]);
  require('../../lib/db').cacheInvalidateLocal?.('figures:');
  const met = (await board(admin)).body.alerts.collection;
  assert.equal(met.target, 1);
  assert.equal(met.belowTarget, false);
});

test('an endpoint slower than the threshold is named for whoever may read the monitor', { skip }, async () => {
  const slow = (await board(admin)).body.alerts.slowEndpoints;
  assert.deepEqual(slow.map(row => row.route), ['GET /api/admin/slow-thing']);
  assert.ok(slow[0].p95 >= 3000);
});

test('the live strip is for view_presence; the monitor for view_security; a ticked account sees neither', { skip }, async () => {
  const owner = (await board(admin)).body;
  assert.ok(owner.live && Number.isInteger(owner.live.staffOnline) && Number.isInteger(owner.live.clientsOnline));
  const other = (await board(ticked)).body;
  assert.equal(other.live, null);
  assert.equal(other.alerts.slowEndpoints, null);
});

test('the one opening the board is counted in at once, before any beat of theirs, and the count is never the held board\'s', { skip }, async () => {
  require('../../lib/staffPresence').resetPresenceForTests();
  await pool.query('DELETE FROM staff_presence WHERE tenant_id=?', [T]);
  assert.equal((await board(admin)).body.live.staffOnline, 1, 'the admin looking at it, with no beat sent');
  // Another employee comes in: the next opening counts them, inside the 20 s the rest of the board is held for.
  await require('../../lib/staffPresence').notePresence({ tenantId: T, staffKey: 'st-bd-other', name: 'موظف', role: 'SALES' }, { screen: 'leads' });
  assert.equal((await board(admin)).body.live.staffOnline, 2);
});

test('who may read it: admin and an account with view_financial and the whole institute 200; sales 403; a branch manager 403; signed out 401', { skip }, async () => {
  assert.equal((await board(admin)).status, 200);
  assert.equal((await board(ticked)).status, 200);
  assert.equal((await board(sales)).status, 403);
  assert.equal((await board(branchManager)).status, 403);
  assert.equal((await board(null)).status, 401);
});
