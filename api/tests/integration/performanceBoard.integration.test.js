'use strict';
/**
 * «لوحة KPI — المدير» per employee and per branch (GET /api/admin/kpi/performance, api/lib/performanceBoard.js) over HTTP on the real app and a real MariaDB, against
 * a ledger small enough to add up by hand — March 2026, with the three months before it for the trend.
 *
 *   A (sales)       leads 4 (one converted, one hidden is left out)      answers: 30 min and 90 min after the lead arrived → 60
 *                   bookings 1000 + 500, instalment 300, certificate 200, a pending 999 (not money)
 *                   Feb 400, Jan 200, Dec 0; March so far 1500 + 300 = 1800 → +800 % on the three-month average of 200
 *                   target 3600 → 50 %     follow-ups waiting 1, contacts made 2 (an incoming message is not one)
 *                   attendance: present 2 (one late, 20 min), absent 1
 *   B (collection)  instalment 700                                      → ranks second
 *   branches        ONLINE_EGYPT: leads 4, converted 1 (25 %), revenue 1500, collections 300, certificates 200
 *                   DAQQI: leads 2, converted 0, collections 700
 * Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
const skip = !ENABLED && 'no DB_* configured';
const { startApp, signInStaff, ensureTenant } = require('./support/http');
const { rangeOf, monthsBack } = require('../../lib/performanceBoard');

const T = 'tenant-perf-board-it';
const OTHER = 'tenant-perf-board-it-other';
const MARCH = '/api/admin/kpi/performance?range=custom&from=2026-03-01&to=2026-03-31';
let pool; let app; let admin; let sales; let ticked; let branchManager;

const at = (day, hour = 10) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00Z`);
let seq = 0;
const lead = async (day, extra = {}) => {
  const id = `ld-pf-${++seq}`;
  await pool.query(
    'INSERT INTO leads (id, tenant_id, name, phone, source, status, hidden, branch, assigned_sales_id, next_follow_up_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, extra.tenant || T, 'ليد', `0106${String(seq).padStart(7, '0')}`, 'فيسبوك', extra.status || 'new', extra.hidden || 0, extra.branch || 'ONLINE_EGYPT', extra.owner || null, extra.followUp || null, at(day)]);
  // the database stamps assigned_at when a rep is given; the test sets the moment it needs
  if (extra.owner) await pool.query('UPDATE leads SET assigned_at = ? WHERE id = ?', [at(day), id]);
  return id;
};
const contact = (leadId, when, staff, direction = 'OUT') => pool.query(
  "INSERT INTO communications (id, tenant_id, lead_id, type, date, notes, staff_id, direction) VALUES (?, ?, ?, 'CALL', ?, '', ?, ?)", [`cm-pf-${++seq}`, T, leadId, new Date(when), staff, direction]);
const payment = (day, amount, staff, extra = {}) => pool.query(
  `INSERT INTO payments (id, tenant_id, subscriber_id, date, amount, currency, fx_rate_to_egp, amount_egp, payment_type, course_id, status, branch, payment_method, is_installment, staff_id, staff_name)
   VALUES (?, ?, 'sub-pf-1', ?, ?, 'EGP', 1, ?, ?, 'co-pf-1', ?, ?, 'كاش', ?, ?, ?)`,
  [`pay-pf-${++seq}`, extra.tenant || T, at(day), amount, amount, extra.type || 'COURSE', extra.status || 'paid', extra.branch || 'ONLINE_EGYPT', extra.installment ? 1 : 0, staff, staff]);
const attendance = (day, status, lateMinutes = 0) => pool.query(
  'INSERT INTO attendance_logs (id, tenant_id, staff_id, branch, date, status, late_minutes) VALUES (?, ?, ?, ?, ?, ?, ?)',
  [`at-pf-${++seq}`, T, 'st-pf-a', 'ONLINE_EGYPT', day, status, lateMinutes]);
const perf = (session, path = MARCH) => app.call('GET', path, { session });
const rowOf = (body, id) => body.employees.find(e => e.id === id);

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await ensureTenant(pool, T);
  await ensureTenant(pool, OTHER);
  app = await startApp(pool);
  admin = await signInStaff(pool, app, { tenantId: T, id: 'st-pf-admin', role: 'ADMIN', name: 'المدير' });
  sales = await signInStaff(pool, app, { tenantId: T, id: 'st-pf-a', role: 'SALES', name: 'أحمد' });
  await signInStaff(pool, app, { tenantId: T, id: 'st-pf-b', role: 'COLLECTION', name: 'بسمة' });
  ticked = await signInStaff(pool, app, { tenantId: T, id: 'st-pf-ticked', role: 'SALES', permissions: ['view_dashboard', 'view_financial'], dataScope: 'all' });
  branchManager = await signInStaff(pool, app, { tenantId: T, id: 'st-pf-bm', role: 'DAQQI_MANAGER', dataScope: 'branch:DAQQI' });
  await pool.query("INSERT INTO courses (id, tenant_id, slug, title, description, short_description, instructor, thumbnail, category, type) VALUES ('co-pf-1', ?, 'co-pf-1', 'دورة', '', '', '', '', 'GENERAL', 'RECORDED')", [T]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, branch) VALUES ('sub-pf-1', ?, 'عميل', '1019100001', 'ONLINE_EGYPT')", [T]);

  const l1 = await lead('2026-03-05', { owner: 'st-pf-a' });
  const l2 = await lead('2026-03-06', { owner: 'st-pf-a' });
  await lead('2026-03-07', { owner: 'st-pf-a', status: 'converted' });
  await lead('2026-03-08', { owner: 'st-pf-a', followUp: '2026-03-15 10:00:00' });
  await lead('2026-03-09', { owner: 'st-pf-a', hidden: 1 });
  await lead('2026-03-09', { branch: 'DAQQI' }); await lead('2026-03-10', { branch: 'DAQQI' });
  await lead('2026-03-09', { tenant: OTHER, owner: 'st-pf-a' });
  await contact(l1, '2026-03-05T10:30:00Z', 'st-pf-a'); // 30 minutes after it arrived
  await contact(l2, '2026-03-06T11:30:00Z', 'st-pf-a'); // 90 minutes
  await contact(l2, '2026-03-06T12:00:00Z', 'st-pf-a', 'IN'); // a client's message is not a contact made

  await payment('2026-03-10', 1000, 'st-pf-a'); await payment('2026-03-20', 500, 'st-pf-a'); await payment('2026-03-12', 300, 'st-pf-a', { installment: true });
  await payment('2026-03-14', 200, 'st-pf-a', { type: 'CERTIFICATE' }); await payment('2026-03-15', 999, 'st-pf-a', { status: 'pending' });
  await payment('2026-03-16', 700, 'st-pf-b', { installment: true, branch: 'DAQQI' });
  await payment('2026-03-16', 5555, 'st-pf-a', { tenant: OTHER });
  await payment('2026-02-10', 400, 'st-pf-a'); await payment('2026-01-10', 200, 'st-pf-a');
  await pool.query("INSERT INTO sales_targets (tenant_id, staff_id, period, revenue_target, leads_target) VALUES (?, 'st-pf-a', '2026-03', 3600, 10)", [T]);
  await attendance('2026-03-02', 'PRESENT'); await attendance('2026-03-03', 'LATE', 20); await attendance('2026-03-04', 'ABSENT');
});

after(async () => {
  if (!ENABLED) return;
  if (app) await app.close();
  await pool.end().catch(() => {});
});

test('each employee\'s month adds up to the ledger: leads, money kept apart, response time, follow-ups, attendance, target, trend, rank', { skip }, async () => {
  const res = await perf(admin);
  assert.equal(res.status, 200, res.text);
  const a = rowOf(res.body, 'st-pf-a');
  assert.deepEqual(a.leads, { received: 4, converted: 1, rate: 25 });
  assert.deepEqual(a.money, { revenue: 1500, collections: 300, certificates: 200, total: 1800 });
  assert.equal(a.responseMinutes, 60);
  assert.deepEqual(a.followUps, { waiting: 1, contacts: 2 });
  assert.deepEqual(a.attendance, { present: 2, late: 1, absent: 1, lateMinutes: 20 });
  assert.deepEqual(a.target, { month: '2026-03', revenue: 3600, leads: 10, achieved: 1800, pct: 50 });
  assert.deepEqual(a.trend, { months: ['2025-12', '2026-01', '2026-02'], money: [0, 200, 400], changeVsAverage: 800, monthToDate: 1800 });
  assert.equal(a.rank, 1);
  const b = rowOf(res.body, 'st-pf-b');
  assert.deepEqual(b.money, { revenue: 0, collections: 700, certificates: 0, total: 700 });
  assert.equal(b.rank, 2);
  assert.equal(b.target, null);
  assert.equal(b.attendance, null);
});

test('each branch: leads and conversion, money by kind, richest first; another tenant\'s rows are not in it', { skip }, async () => {
  const { branches } = (await perf(admin)).body;
  assert.deepEqual(branches.map(b => b.branch), ['ONLINE_EGYPT', 'DAQQI']);
  assert.deepEqual(branches[0], { branch: 'ONLINE_EGYPT', received: 4, converted: 1, revenue: 1500, collections: 300, certificates: 200, rate: 25, total: 1800 });
  assert.deepEqual(branches[1], { branch: 'DAQQI', received: 2, converted: 0, revenue: 0, collections: 700, certificates: 0, rate: 0, total: 700 });
});

test('a day, a week, a month or a custom range; a reversed or oversized custom range is put right', () => {
  assert.deepEqual(rangeOf({ range: 'today' }, '2026-11-07'), { from: '2026-11-07', to: '2026-11-07' });
  assert.deepEqual(rangeOf({ range: 'week' }, '2026-11-07'), { from: '2026-11-01', to: '2026-11-07' });
  assert.deepEqual(rangeOf({}, '2026-11-07'), { from: '2026-11-01', to: '2026-11-07' });
  assert.deepEqual(rangeOf({ range: 'custom', from: '2026-03-31', to: '2026-03-01' }), { from: '2026-03-01', to: '2026-03-31' });
  assert.equal(rangeOf({ range: 'custom', from: '2020-01-01', to: '2026-01-01' }).to, '2020-12-31');
  assert.deepEqual(rangeOf({ range: 'custom', from: 'x', to: 'y' }, '2026-11-07'), { from: '2026-11-01', to: '2026-11-07' });
  assert.deepEqual(monthsBack('2026-02-15', 3), ['2025-11-01', '2025-12-01', '2026-01-01']);
});

test('who may read it: admin and an account with view_financial and the whole institute 200; sales 403; a branch manager 403; signed out 401', { skip }, async () => {
  assert.equal((await perf(admin)).status, 200);
  assert.equal((await perf(ticked)).status, 200);
  assert.equal((await perf(sales)).status, 403);
  assert.equal((await perf(branchManager)).status, 403);
  assert.equal((await perf(null)).status, 401);
});
