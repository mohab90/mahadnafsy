'use strict';
/**
 * «تقارير الإدارة» (lib/managementReports.js, routes/analytics/management-reports.js) on a real MariaDB, every figure exact.
 *
 * Period P = Cairo days 9-15 Mar 2026 (UTC+2: P starts at 8 Mar 22:00 UTC and ends at 15 Mar 22:00 UTC); the previous equal period is 2-8 Mar.
 * Two branches (Online, الدقي) plus a general expense, three employees (s1 and s2 sales, s3 collection).
 *
 *  payments in P                       client (rep / cs)   kind         branch
 *   pA1  A c1 1000 booking              A (s1 / s3)         BOOKING      Online
 *   pB1  B c2 2000 booking              B (s1)  returning   BOOKING      Online
 *   pB2  B c1  500 plan instalment      B                   INSTALMENT   Online
 *   pC1  C c1 3000 booking              C (s2)              BOOKING      Daqqi
 *   pC2  C c1  700 later, not a plan    C                   INSTALMENT   Daqqi
 *   pD1  D c2 SAR 500 = 1300 EGP        D (s2)              BOOKING      Online (Saudi)
 *   pCert A certificate 300             A                   CERTIFICATE  Online
 *   pCarn B carnet 200 / pBook C book 150 / pCons A consultation 400 (on the last day, 15 Mar)
 *   pFor D carnet SAR 100 with no pound value: counted apart, 0 EGP
 *   refunded 900, deleted 5000, pending 777: not income;  8 Mar and 16 Mar rows: outside
 *  Online 5,700 (4,300 + 500 + 300 + 600)   الدقي 3,850 (3,000 + 700 + 150)   total 9,550
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
// The default tenant: every /api/admin/reports path is closed to the others (middleware/legacyTenantContainment.js). The runner gives this file its own database.
const T = 'tenant-default';
const PERIOD = { period: 'custom', from: '2026-03-09', to: '2026-03-15' };
let pool; let reports; let app; let who;

async function clean() {
  for (const table of ['installment_entries', 'installment_plans', 'communications', 'leads', 'expenses', 'payments', 'subscribers', 'courses', 'staff', 'users', 'tenant_settings', 'tenant_subscriptions']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}
let seq = 0;
const client = (id, branch, sales, cs) => pool.query(
  'INSERT INTO subscribers (id, tenant_id, name, phone, branch, branch_id, assigned_sales_id, assigned_cs_id) VALUES (?,?,?,?,?,?,?,?)',
  [id, T, `عميل ${id}`, `1018${String(++seq).padStart(6, '0')}`, branch, branch === 'DAQQI' ? 'branch-daqqi' : 'branch-online-egypt', sales, cs]);
const staff = (id, role, branchId) => pool.query(
  "INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, branch_id) VALUES (?,?,?,?,?,?,1,'2025-01-01',?)",
  [id, T, `موظف ${id}`, `${id}@mr.test`, `1019${String(++seq).padStart(6, '0')}`, role, branchId]);
const pay = (id, o) => pool.query(
  `INSERT INTO payments (id, tenant_id, subscriber_id, course_id, branch, amount, currency, amount_egp, payment_type, status, is_installment, date, deleted_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  [`mr-${id}`, T, o.client, o.course || null, o.branch || null, o.amount, o.currency || 'EGP', o.egp === undefined ? (o.currency && o.currency !== 'EGP' ? null : o.amount) : o.egp,
    o.type || 'COURSE', o.status || 'paid', o.inst ? 1 : 0, `${o.day} 00:00:00`, o.deleted ? '2026-03-20 10:00:00' : null]);
const expense = (id, o) => pool.query(
  'INSERT INTO expenses (id, tenant_id, description, amount, currency, amount_egp, category, date, branch_id, deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
  [`mr-${id}`, T, id, o.amount, 'EGP', o.amount, o.category, `${o.day} 00:00:00`, o.branch || null, o.deleted ? '2026-03-20 10:00:00' : null]);
const comm = (type, at, staffId, direction = 'OUT') => pool.query(
  "INSERT INTO communications (id, tenant_id, type, date, notes, staff_id, direction) VALUES (?,?,?,?,'x',?,?)",
  [`mr-c${++seq}`, T, type, at, staffId, direction]);
const lead = (staffId, at, extra = {}) => pool.query(
  'INSERT INTO leads (id, tenant_id, name, source, status, assigned_sales_id, assigned_at, next_follow_up_date) VALUES (?,?,?,?,?,?,?,?)',
  [`mr-l${++seq}`, T, 'ليد', 'test', extra.status || 'new', staffId, at, extra.follow || null]);

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  reports = require('../../lib/managementReports');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'Mgmt IT', 'active')", [T, T]);
  await pool.query("INSERT INTO tenant_subscriptions (id, tenant_id, status, starts_at) VALUES (?, ?, 'active', '2025-01-01')", [`sub-${T}`, T]);
  for (const [id, title] of [['c1', 'كورس 1'], ['c2', 'كورس 2']]) {
    await pool.query(
      `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp)
       VALUES (?, ?, ?, '', '', '', '', 'GENERAL', 'RECORDED', 3000)`, [id, T, title]);
  }
  await staff('s1', 'SALES', 'branch-online-egypt'); await staff('s2', 'SALES', 'branch-daqqi'); await staff('s3', 'COLLECTION', 'branch-online-egypt');
  await client('A', 'ONLINE_EGYPT', 's1', 's3'); await client('B', 'ONLINE_EGYPT', 's1', null); await client('C', 'DAQQI', 's2', null);
  await client('D', 'ONLINE_SAUDI', 's2', null); await client('E', 'ONLINE_EGYPT', 's1', null); await client('F', 'ONLINE_EGYPT', null, 's3');

  // B paid for c1 long before P: a returning client. Everyone else's first course payment is in P (or E's, in the previous period).
  await pay('Bold', { client: 'B', course: 'c1', amount: 1000, day: '2026-02-01' });
  await pay('A1', { client: 'A', course: 'c1', amount: 1000, day: '2026-03-10' });
  await pay('B1', { client: 'B', course: 'c2', amount: 2000, day: '2026-03-11' });
  await pay('B2', { client: 'B', course: 'c1', amount: 500, inst: true, day: '2026-03-12' });
  await pay('C1', { client: 'C', course: 'c1', amount: 3000, day: '2026-03-10', branch: 'DAQQI' });
  await pay('C2', { client: 'C', course: 'c1', amount: 700, day: '2026-03-11', branch: 'DAQQI' });
  await pay('D1', { client: 'D', course: 'c2', amount: 500, currency: 'SAR', egp: 1300, day: '2026-03-14' });
  await pay('Cert', { client: 'A', amount: 300, type: 'CERTIFICATE', day: '2026-03-12' });
  await pay('Carn', { client: 'B', amount: 200, type: 'CARNEH', day: '2026-03-12' });
  await pay('Book', { client: 'C', amount: 150, type: 'BOOK', day: '2026-03-13', branch: 'DAQQI' });
  await pay('Cons', { client: 'A', amount: 400, type: 'CONSULTATION', day: '2026-03-15' });
  await pay('For', { client: 'D', amount: 100, currency: 'SAR', egp: null, type: 'CARNEH', day: '2026-03-13' });
  await pay('Ref', { client: 'A', course: 'c1', amount: 900, status: 'refunded', day: '2026-03-12' });
  await pay('Del', { client: 'A', course: 'c2', amount: 5000, deleted: true, day: '2026-03-12' });
  await pay('Pend', { client: 'A', course: 'c2', amount: 777, status: 'pending', day: '2026-03-12' });
  await pay('After', { client: 'A', amount: 8888, type: 'CONSULTATION', day: '2026-03-16' });
  await pay('PrevE', { client: 'E', course: 'c1', amount: 600, day: '2026-03-05' });
  await pay('PrevF', { client: 'F', amount: 100, type: 'CERTIFICATE', day: '2026-03-08' });

  await expense('e1', { amount: 1000, category: 'RENT', day: '2026-03-10', branch: 'branch-online-egypt' });
  await expense('e2', { amount: 2500, category: 'SALARIES', day: '2026-03-11', branch: 'branch-daqqi' });
  await expense('e3', { amount: 300, category: 'MARKETING', day: '2026-03-15', branch: 'branch-online-egypt' });
  await expense('e4', { amount: 50, category: 'OTHER', day: '2026-03-12' });
  await expense('e5', { amount: 999, category: 'RENT', day: '2026-03-12', branch: 'branch-online-egypt', deleted: true });
  await expense('e6', { amount: 777, category: 'RENT', day: '2026-03-16', branch: 'branch-online-egypt' });
  await expense('e7', { amount: 400, category: 'RENT', day: '2026-03-04', branch: 'branch-online-egypt' });

  // B's plan: two entries due in P (one paid), one after.
  await pool.query("INSERT INTO installment_plans (id, subscriber_id, total_amount, currency, tenant_id, status) VALUES ('mr-plan', 'B', 1500, 'EGP', ?, 'active')", [T]);
  for (const [seq2, due, paid] of [[1, '2026-03-11', 1], [2, '2026-03-14', 0], [3, '2026-03-16', 0]]) {
    await pool.query("INSERT INTO installment_entries (id, plan_id, tenant_id, seq, due_date, amount, paid, subscriber_id) VALUES (?, 'mr-plan', ?, ?, ?, 500, ?, 'B')",
      [`mr-ent-${seq2}`, T, seq2, due, paid]);
  }

  // Cairo midnights: P is [8 Mar 22:00, 15 Mar 22:00) UTC.
  for (const at of ['2026-03-08 22:00:00', '2026-03-12 10:00:00', '2026-03-15 21:59:59', '2026-03-08 21:59:59', '2026-03-15 22:00:00']) await comm('CALL', at, 's1');
  await comm('WHATSAPP', '2026-03-09 08:00:00', 's1'); await comm('WHATSAPP', '2026-03-10 08:00:00', 's1');
  await comm('WHATSAPP', '2026-03-10 09:00:00', 's1', 'IN'); await comm('MESSENGER', '2026-03-10 09:00:00', 's1'); await comm('WHATSAPP', '2026-03-10 09:30:00', null);
  await comm('CALL', '2026-03-11 10:00:00', 's2'); await comm('WHATSAPP', '2026-03-11 10:00:00', 's2');
  for (const at of ['2026-03-08 22:00:00', '2026-03-15 21:59:59', '2026-03-10 10:00:00', '2026-03-11 10:00:00', '2026-03-08 21:59:59', '2026-03-15 22:00:00']) await lead('s1', at);
  await lead('s2', '2026-03-12 10:00:00'); await lead('s2', '2026-03-13 10:00:00');
  await lead('s1', '2026-02-01 10:00:00', { follow: '2026-03-12 00:00:00' });

  const { startApp, signInStaff } = require('./support/http');
  app = await startApp(pool);
  who = {
    owner: await signInStaff(pool, app, { tenantId: T, id: 'mr-owner', role: 'ADMIN' }),
    daqqiManager: await signInStaff(pool, app, { tenantId: T, id: 'mr-dq', role: 'DAQQI_MANAGER', branchId: 'branch-daqqi', dataScope: 'branch:DAQQI', permissions: ['view_reports'] }),
    rep: await signInStaff(pool, app, { tenantId: T, id: 'mr-rep', role: 'SALES' }),
    collection: await signInStaff(pool, app, { tenantId: T, id: 'mr-col', role: 'COLLECTION' }),
  };
});
after(async () => { if (!ENABLED) return; await app.close(); await clean(); await pool.end(); });

const branches = async () => reports.buildBranchReport({ tenantId: T, period: PERIOD, today: '2026-03-20' });
const byKey = (report, key) => report.branches.find(branch => branch.key === key);
const money = branch => [branch.incomeEgp, branch.bookingsEgp, branch.installmentsEgp, branch.certificatesEgp, branch.otherEgp];

test('the period and the previous equal one', { skip }, async () => {
  const { resolvePeriod } = require('../../lib/managementReportsPeriod');
  const p = resolvePeriod(PERIOD, '2026-03-20');
  assert.deepEqual([p.from, p.to, p.days, p.previous.from, p.previous.to], ['2026-03-09', '2026-03-15', 7, '2026-03-02', '2026-03-08']);
  const month = resolvePeriod({ period: 'month' }, '2026-11-11');
  assert.deepEqual([month.from, month.to, month.previous.from, month.previous.to], ['2026-11-01', '2026-11-11', '2026-10-01', '2026-10-11']);
  const last = resolvePeriod({ period: 'last_month' }, '2026-03-20');
  assert.deepEqual([last.from, last.to, last.previous.from, last.previous.to], ['2026-02-01', '2026-02-28', '2026-01-01', '2026-01-31']);
  const week = resolvePeriod({ period: 'week' }, '2026-11-11'); // Wednesday: the week began on Saturday 7 Nov
  assert.deepEqual([week.from, week.to, week.previous.from, week.previous.to], ['2026-11-07', '2026-11-11', '2026-10-31', '2026-11-04']);
});

test('branch income: four lines that add up to the total, by branch', { skip }, async () => {
  const report = await branches();
  assert.deepEqual(report.branches.map(branch => branch.key), ['ONLINE', 'DAQQI', 'TAGAMOA', 'OTHER']);
  const online = byKey(report, 'ONLINE'); const daqqi = byKey(report, 'DAQQI');
  assert.deepEqual(money(online), [5700, 4300, 500, 300, 600]);
  assert.deepEqual(money(daqqi), [3850, 3000, 700, 0, 150]);
  assert.deepEqual(money(report.total), [9550, 7300, 1200, 300, 750]);
  for (const branch of [...report.branches, report.total]) {
    assert.equal(branch.bookingsEgp + branch.installmentsEgp + branch.certificatesEgp + branch.otherEgp, branch.incomeEgp, `${branch.key}: the four lines are the income`);
    assert.equal(branch.other.reduce((total, line) => total + line.egp, 0), branch.otherEgp, `${branch.key}: the sub-lines of أخرى are أخرى`);
  }
  assert.equal(report.branches.reduce((total, branch) => total + branch.incomeEgp, 0), report.total.incomeEgp);
  assert.deepEqual(online.other.map(line => [line.kind, line.label, line.egp]).sort(), [['CARNEH', 'كارنيهات', 200], ['CONSULTATION', 'استشارات', 400]]);
  assert.deepEqual(daqqi.other.map(line => [line.kind, line.label, line.egp]), [['BOOK', 'كتب', 150]]);
});

test('a refunded, deleted or pending payment is not income; a foreign payment with no pound value is counted apart', { skip }, async () => {
  const report = await branches();
  assert.equal(byKey(report, 'ONLINE').refundsEgp, 900);
  assert.equal(report.total.refundsEgp, 900);
  assert.deepEqual(byKey(report, 'ONLINE').unconverted, { payments: 1, byCurrency: { SAR: 100 } });
  assert.deepEqual(report.total.unconverted, { payments: 1, byCurrency: { SAR: 100 } });
  assert.equal(byKey(report, 'DAQQI').unconverted.payments, 0);
});

test('expenses by category and branch, the general one apart, and the net', { skip }, async () => {
  const report = await branches();
  const online = byKey(report, 'ONLINE'); const daqqi = byKey(report, 'DAQQI'); const other = byKey(report, 'OTHER');
  assert.deepEqual([online.expensesEgp, daqqi.expensesEgp, other.expensesEgp, report.total.expensesEgp], [1300, 2500, 50, 3850]);
  assert.deepEqual(online.expensesByCategory.map(line => [line.category, line.egp]), [['RENT', 1000], ['MARKETING', 300]]);
  assert.deepEqual([online.netEgp, daqqi.netEgp, other.netEgp, report.total.netEgp], [4400, 1350, -50, 5700]);
  assert.equal(report.branches.reduce((total, branch) => total + branch.netEgp, 0), report.total.netEgp);
});

test('new clients, returning clients with a new course, bookings and the average ticket', { skip }, async () => {
  const report = await branches();
  const online = byKey(report, 'ONLINE'); const daqqi = byKey(report, 'DAQQI');
  // Online: A and D are new (first course payment ever is in P); B paid on 1 Feb, so his c2 is a returning client's new booking.
  assert.deepEqual([online.bookings, online.bookingClients, online.newClients, online.returningClients, online.returningBookings], [3, 3, 2, 1, 1]);
  assert.equal(Math.round(online.avgTicketEgp * 100) / 100, Math.round((4300 / 3) * 100) / 100);
  // الدقي: C's second payment on c1 is not a booking.
  assert.deepEqual([daqqi.bookings, daqqi.newClients, daqqi.returningClients, daqqi.avgTicketEgp], [1, 1, 0, 3000]);
  assert.deepEqual([report.total.bookings, report.total.newClients, report.total.returningClients], [4, 3, 1]);
});

test('instalments due and collected, and the top courses', { skip }, async () => {
  const online = byKey(await branches(), 'ONLINE');
  assert.deepEqual([online.instalmentsDue, online.instalmentsPaid, online.instalmentsDueEgp, online.instalmentsPaidEgp, online.collectionRatePct], [2, 1, 1000, 500, 50]);
  assert.deepEqual(online.topCourses.map(course => [course.title, course.egp]), [['كورس 2', 3300], ['كورس 1', 1500]]);
});

test('the previous equal period beside every figure, and the change', { skip }, async () => {
  const report = await branches();
  const online = byKey(report, 'ONLINE');
  assert.deepEqual(online.vs.incomeEgp, { before: 700, change: 5000, changePct: 714.3 });
  assert.deepEqual(online.vs.bookingsEgp, { before: 600, change: 3700, changePct: 616.7 });
  assert.deepEqual(online.vs.certificatesEgp, { before: 100, change: 200, changePct: 200 });
  assert.deepEqual(online.vs.expensesEgp, { before: 400, change: 900, changePct: 225 });
  assert.deepEqual(online.vs.bookings, { before: 1, change: 2, changePct: 200 });
  assert.equal(byKey(report, 'DAQQI').vs.incomeEgp.changePct, null, 'nothing before: no percentage');
});

test('weekly (8) and monthly (6) series per branch for income, expenses and net', { skip }, async () => {
  const report = await reports.buildBranchReport({ tenantId: T, period: PERIOD, today: '2026-03-14' });
  assert.equal(report.series.weekly.length, 8);
  assert.equal(report.series.monthly.length, 6);
  // 14 Mar 2026 is a Saturday, so the last week (Saturday to Friday) began that day and the one before it on 7 Mar.
  assert.equal(report.series.weekly[7].from, '2026-03-14');
  const week = report.series.weekly.find(point => point.from === '2026-03-07');
  assert.deepEqual(week.branches.ONLINE, { incomeEgp: 4100, expensesEgp: 1000, netEgp: 3100 });
  assert.deepEqual(week.branches.DAQQI, { incomeEgp: 3850, expensesEgp: 2500, netEgp: 1350 });
  assert.deepEqual(week.total, { incomeEgp: 7950, expensesEgp: 3550, netEgp: 4400 });
  assert.deepEqual(report.series.weekly[7].branches.ONLINE, { incomeEgp: 10588, expensesEgp: 1077, netEgp: 9511 });
  assert.equal(report.series.weekly.find(point => point.from === '2026-02-28').branches.ONLINE.incomeEgp, 600);
  assert.equal(report.series.monthly[5].label, '2026-03');
  assert.equal(report.series.monthly[5].branches.ONLINE.incomeEgp, 15288);
  assert.equal(report.series.monthly[4].branches.ONLINE.incomeEgp, 1000);
});

const employees = async (scope = null) => reports.buildEmployeeReport({ tenantId: T, period: PERIOD, scope, today: '2026-03-12' });
const row = (report, id) => report.rows.find(item => item.id === id);

test('employees: calls, WhatsApp and leads at the Cairo midnight edges', { skip }, async () => {
  const report = await employees();
  const s1 = row(report, 's1'); const s2 = row(report, 's2'); const s3 = row(report, 's3');
  // s1: 3 calls inside (two exactly on the edges), 2 just outside; 2 WhatsApp sent (an inbound, a Messenger and a bot message are not hers).
  assert.deepEqual([s1.calls, s1.whatsapp, s1.leads], [3, 2, 4]);
  assert.deepEqual([s2.calls, s2.whatsapp, s2.leads], [1, 1, 2]);
  assert.deepEqual([s3.calls, s3.whatsapp, s3.leads], [0, 0, 0]);
  assert.deepEqual([s1.followUpsDue, s1.followUpsOverdue], [1, 0]);
});

test('employees: bookings, clients and the collected money split four ways', { skip }, async () => {
  const report = await employees();
  const s1 = row(report, 's1'); const s2 = row(report, 's2'); const s3 = row(report, 's3');
  assert.deepEqual([s1.bookings, s1.bookingClients, s1.bookingsEgp, s1.installmentsEgp, s1.certificatesEgp, s1.otherEgp, s1.collectedEgp], [2, 2, 3000, 500, 0, 200, 3700]);
  assert.deepEqual([s2.bookings, s2.bookingClients, s2.bookingsEgp, s2.installmentsEgp, s2.certificatesEgp, s2.otherEgp, s2.collectedEgp], [2, 2, 4300, 700, 0, 150, 5150]);
  assert.deepEqual([s3.bookings, s3.bookingsEgp, s3.installmentsEgp, s3.certificatesEgp, s3.otherEgp, s3.collectedEgp], [0, 0, 0, 300, 400, 700]);
  assert.deepEqual([s1.conversionPct, s2.conversionPct, s3.conversionPct], [50, 100, null]);
  assert.deepEqual([s1.avgTicketEgp, s2.avgTicketEgp], [1500, 2150]);
  for (const person of report.rows) assert.equal(person.bookingsEgp + person.installmentsEgp + person.certificatesEgp + person.otherEgp, person.collectedEgp);
});

test('employees: the totals row is the sum of the rows, and equals the branch report', { skip }, async () => {
  const report = await employees(); const branch = await branches();
  const sum = key => report.rows.reduce((total, item) => total + item[key], 0);
  for (const key of ['calls', 'whatsapp', 'leads', 'bookings', 'bookingsEgp', 'installmentsEgp', 'certificatesEgp', 'otherEgp', 'collectedEgp']) assert.equal(report.totals[key], sum(key), key);
  assert.equal(report.totals.collectedEgp, 9550);
  assert.equal(report.unattributed.collectedEgp, 0);
  assert.equal(report.totals.collectedEgp + report.unattributed.collectedEgp, branch.total.incomeEgp);
  assert.equal(report.totals.bookingsEgp, branch.total.bookingsEgp);
  assert.equal(report.totals.installmentsEgp, branch.total.installmentsEgp);
});

test('employees: the previous equal period for bookings and money', { skip }, async () => {
  const report = await employees();
  assert.deepEqual(row(report, 's1').vsBookings, { before: 1, change: 1, changePct: 100 });
  assert.deepEqual(row(report, 's1').vsCollected, { before: 600, change: 3100, changePct: 516.7 });
  assert.deepEqual(row(report, 's3').vsCollected, { before: 100, change: 600, changePct: 600 });
  assert.equal(row(report, 's2').vsCollected.changePct, null);
});

test('over HTTP: the owner reads both reports; a rep and a collection officer get 403', { skip }, async () => {
  const query = '?period=custom&from=2026-03-09&to=2026-03-15';
  const asOwner = await app.call('GET', `/api/admin/reports/management/branches${query}`, { session: who.owner });
  assert.equal(asOwner.status, 200, asOwner.text);
  assert.equal(asOwner.body.total.incomeEgp, 9550);
  assert.equal((await app.call('GET', `/api/admin/reports/management/employees${query}`, { session: who.owner })).body.totals.collectedEgp, 9550);
  for (const key of ['rep', 'collection']) {
    for (const kind of ['branches', 'employees']) assert.equal((await app.call('GET', `/api/admin/reports/management/${kind}${query}`, { session: who[key] })).status, 403, `${key} ${kind}`);
  }
  assert.equal((await app.call('GET', `/api/admin/reports/management/branches${query}`)).status, 401);
});

test('over HTTP: a branch manager sees his branch only, in both reports', { skip }, async () => {
  const query = '?period=custom&from=2026-03-09&to=2026-03-15';
  const branchReport = await app.call('GET', `/api/admin/reports/management/branches${query}`, { session: who.daqqiManager });
  assert.equal(branchReport.status, 200, branchReport.text);
  assert.deepEqual(branchReport.body.branches.map(branch => branch.key), ['DAQQI']);
  assert.deepEqual(money(branchReport.body.total), [3850, 3000, 700, 0, 150]);
  assert.equal(branchReport.body.total.expensesEgp, 2500);
  assert.equal(branchReport.body.scope, 'branch');
  const staffReport = await app.call('GET', `/api/admin/reports/management/employees${query}`, { session: who.daqqiManager });
  assert.equal(staffReport.status, 200);
  assert.deepEqual(staffReport.body.rows.map(item => item.id), ['s2'], 'only the employees of his branch');
  assert.deepEqual([staffReport.body.rows[0].bookings, staffReport.body.rows[0].collectedEgp], [1, 3850], 'and only the money of his branch');
});
