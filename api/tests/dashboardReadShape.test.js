'use strict';
/**
 * The reads behind the admin dashboard. Every fault below is the same shape:
 * the database's answer and the screen's expectation differ by one convention —
 * a case, a key, a type — and nothing on either side complains. Run: npm run test:unit
 */
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toNumbers } = require('../lib/mappers');
const { EXPENSE_CATEGORY_LABEL } = require('../lib/expenseCategories');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('DECIMAL columns reach a screen as numbers, so adding two of them is addition', () => {
  const payslips = [
    { net_salary: '9500.00', late_deductions: '150.00', advance_deductions: '500.00',
      absence_deductions: '0.00', other_deductions: '0.00' },
    { net_salary: '8000.00', late_deductions: '0.00', advance_deductions: '0.00',
      absence_deductions: '0.00', other_deductions: '0.00' },
  ].map(row => toNumbers(row, [
    'net_salary', 'late_deductions', 'advance_deductions', 'absence_deductions', 'other_deductions',
  ]));

  const deductions = payslips[0].absence_deductions + payslips[0].late_deductions
    + payslips[0].other_deductions + payslips[0].advance_deductions;
  assert.equal(deductions, 650, 'concatenated, this was "0.00150.000.00500.00" and rendered as a dash');
  assert.equal(payslips.reduce((sum, item) => sum + item.net_salary, 0), 17500,
    'concatenated, the run total printed "09500.008000.00"');
});

test('the payroll and expense routes convert their money before answering', () => {
  const payroll = codeOnly(read('api/routes/hr/payroll.js'));
  assert.ok(payroll.includes('toNumbers(item, PAYROLL_ITEM_MONEY)'), 'the payslip list converts');
  assert.ok(payroll.includes('toNumbers(updatedRun, PAYROLL_RUN_MONEY)'), 'and so does /calculate');
  for (const field of ['net_salary', 'commission', 'late_deductions', 'instructor_earnings']) {
    assert.ok(payroll.includes(`'${field}'`), `${field} must be in the money list`);
  }
  // The run list and the audit log were the two that shipped a raw DECIMAL to
  // a screen that formats it: toLocaleString on a string returns the string, so
  // a 185,000 run printed "185000.00 ج.م" right after the same run had rendered
  // correctly from /calculate.
  assert.ok(payroll.includes('runs.map(run => toNumbers(run, PAYROLL_RUN_MONEY))'));
  const payops = codeOnly(read('api/routes/core/payops.js'));
  assert.ok(payops.includes("rows.map(row => toNumbers(row, ['amount']))"));

  const expenses = codeOnly(read('api/routes/admin-operations.js'));
  assert.ok(expenses.includes('toNumbers(row, EXPENSE_MONEY)'));
  assert.ok(expenses.includes('date: safeDateOnly(row.date)'),
    'expenses.date is a DATETIME and was rendered as a raw ISO timestamp');
});

test('a budget finds its spend: one side keys by code, the other by Arabic label', () => {
  const spendMap = {};
  for (const row of [{ category: 'MARKETING', spent: '30000.00' }]) {
    const spent = parseFloat(row.spent) || 0;
    spendMap[row.category] = spent;
    const label = EXPENSE_CATEGORY_LABEL[row.category];
    if (label) spendMap[label] = spent;
  }
  assert.equal(spendMap['تسويق'], 30000, 'budgets.category holds the Arabic label');
  assert.equal(spendMap.MARKETING, 30000, 'and the code still resolves for anything storing that');
});

test('orders leave the API in the case every reader compares against', () => {
  const orders = codeOnly(read('api/routes/orders.js'));
  assert.ok(orders.includes("status: String(row.status || 'paid').toLowerCase()"));
  assert.ok(orders.includes("type: String(row.type || 'course').toLowerCase()"));
  assert.ok(orders.includes('res.json([...normalized, ...crmOrders])'),
    'the normalised rows must be the ones sent');

  // orders.status/type are UPPERCASE ENUM members and migration 096's
  // UPDATE ... SET status='pending' WHERE status='PENDING' is a no-op against
  // one, so production really does hold PENDING/PAID and COURSE/BUNDLE.
  const runtime = codeOnly(read('admin/context/site-data-hooks/useAdminDataRuntime.ts'));
  assert.ok(runtime.includes("String(row.status || 'paid').toLowerCase()"));
  assert.ok(runtime.includes("String(row.type || 'course').toLowerCase()"));
  for (const field of ['courseId', 'bundleId', 'paidAt']) {
    assert.ok(runtime.includes(`${field}: (row.`), `${field} was selected by the route and dropped here`);
  }
});

test('the consultation calendar reads the field the API actually sends', () => {
  const calendar = codeOnly(read('admin/pages/dashboard/tabs/ConsultationCalendarTab.tsx'));
  assert.ok(calendar.includes('item.sessionDate || item.scheduledAt || item.date'),
    'sessionDate is what /api/admin/consultations returns');
  assert.ok(!calendar.includes("(c.scheduledAt || c.date || '')"),
    'no reader may still key on the two fields that never arrive');
  // consultations.status is enum('PENDING','CONFIRMED','COMPLETED','CANCELLED').
  assert.ok(calendar.includes("confirmed: 'مؤكدة'"), 'confirmed had no label');
  assert.ok(!calendar.includes("scheduled: 'مجدولة'"), "'scheduled' is not a status this system has");
  assert.ok(!calendar.includes('no_show'), "nor is 'no_show'");
});

test('a month is a month, and the previous month is a different one', () => {
  const addMonths = (anchor, months) => {
    const [year, month, day] = anchor.split('-').map(Number);
    const total = (month - 1) + months;
    const targetYear = year + Math.floor(total / 12);
    const targetMonth = (total % 12) + 1;
    const lastOfTarget = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
    return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(Math.min(day, lastOfTarget)).padStart(2, '0')}`;
  };
  assert.deepEqual([0, 1, 2, 3].map(i => addMonths('2026-01-31', i)),
    ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'],
    'stepping 30 days skipped February entirely, and clamping without an anchor drifts');
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15', 'and it rolls the year');

  const planning = codeOnly(read('api/routes/finance-planning.js'));
  assert.ok(planning.includes('addMonths(anchor, step)'));
  assert.ok(!planning.includes("cadence === 'weekly' ? 7 : 30"), 'a month is not 30 days');

  const dashboard = codeOnly(read('api/routes/analytics/dashboard.js'));
  assert.ok(!dashboard.includes('setMonth(d.getMonth() - 1)'),
    'setMonth keeps the day, so on 31 March prevMonthStart equalled monthStart');
  assert.ok(dashboard.includes('const today   = dateOnlyInTimeZone()'),
    'and the day the institute trades in is Cairo’s, not UTC’s');
});

test('lead distribution hands out only the leads that are still open', () => {
  const distribute = codeOnly(read('api/routes/lead-capture-crm.js'));
  assert.ok(distribute.includes('[...LEAD_STATUSES].filter(isOpenLeadStatus)'),
    'ten statuses are terminal; this excluded two');
  assert.ok(!distribute.includes("status NOT IN ('converted','lost')"),
    'archived, wrong_number and the rest were being redistributed');
  assert.ok(distribute.includes('[tenantId, ...openStatuses]'), 'and the placeholders must be bound');
});

test('a Dokki round counts only the money paid for its own course', () => {
  const attendees = codeOnly(read('api/lib/daqqiAttendees.js'));
  assert.ok(!attendees.includes('p.course_id IS NULL'),
    'course_id is NULL for certificates, consultations, books and every bundle payment');
  assert.ok(attendees.includes('bc.course_id=dr.course_id'),
    'a bundle containing this round’s course still counts, as the booking INSERT already had it');
});

test('an open transaction never goes back to the pool on an early return', () => {
  const recruiting = read('api/routes/hr/recruiting.js');
  const handler = recruiting.slice(recruiting.indexOf("router.put('/api/admin/hr/jobs/:jobId'"));
  const full = handler.slice(0, handler.indexOf('\n});'));
  // Only the returns that happen after the transaction opens — the validation
  // 400 above it has nothing to roll back.
  const body = full.slice(full.indexOf('beginTransaction'));
  const earlyReturns = body.match(/return res\.status\((400|403|404)\)/g) || [];
  assert.ok(earlyReturns.length >= 4, 'this handler has several exits inside the transaction');
  // mysql2 sends no COM_RESET_CONNECTION on release, so a connection returned
  // mid-transaction keeps its row locks and its read snapshot.
  const rollbacks = body.match(/await conn\.rollback\(\); transactionStarted = false;/g) || [];
  assert.equal(rollbacks.length, earlyReturns.length,
    'every early return inside the transaction must roll back first');
});

test('deleted rows and unpaid money stay out of the admin reads that ignored them', () => {
  const records = codeOnly(read('api/routes/hr/records.js'));
  const documents = records.slice(records.indexOf("router.get('/api/admin/hr/documents'"));
  assert.ok(documents.slice(0, documents.indexOf('res.json')).includes('d.deleted_at IS NULL'),
    'a soft-deleted document stayed in the admin list while the employee’s own list dropped it');

  const utils = codeOnly(read('api/routes/admin-utils.js'));
  const forecast = utils.slice(utils.indexOf("router.get('/api/admin/forecast'"));
  const monthly = forecast.slice(0, forecast.indexOf('GROUP BY month'));
  assert.ok(monthly.includes("status='paid'") && monthly.includes('deleted_at IS NULL'),
    'failed and refunded payments were training the revenue forecast');

  const exportRoute = utils.slice(utils.indexOf("router.get('/api/admin/export/subscribers'"));
  const query = exportRoute.slice(0, exportRoute.indexOf('const cols'));
  assert.ok(query.includes("AS status"), 'the CSV asked for a column the query never returned');
  assert.ok(!query.includes('LEFT JOIN payments p'),
    'summing across the enrolments join multiplied every total by the enrolment count');
});

test('one payment is one payment, however many lists it appears in', () => {
  // /api/admin/orders synthesises an order from every payments row, keeping the
  // payment's id, and paymentHistory is built from those same rows.
  const paidOrders = [{ id: 'PAY-1', amount: 4000, currency: 'EGP', status: 'paid' }];
  const subscribers = [{
    paymentHistory: [
      { id: 'PAY-1', amount: 4000, currency: 'EGP', status: 'paid' },
      { id: 'PAY-2', amount: 1000, currency: 'EGP', status: 'refunded' },
      { id: 'PAY-3', amount: 500, currency: 'EGP', status: 'paid' },
    ],
  }];
  const countedOrderIds = new Set(paidOrders.map(o => o.id));
  const total = paidOrders.reduce((sum, o) => sum + o.amount, 0)
    + subscribers.reduce((s, sub) => s + sub.paymentHistory
      .filter(p => !p.isInstallment && (!p.status || p.status === 'paid') && !countedOrderIds.has(p.id))
      .reduce((ps, p) => ps + p.amount, 0), 0);
  assert.equal(total, 4500, 'the shared payment counts once and the refund not at all');

  const overview = codeOnly(read('admin/pages/dashboard/hooks/useOverviewDerived.ts'));
  assert.ok(overview.includes('!countedOrderIds.has(p.id)'));
  assert.ok(overview.includes("(!p.status || p.status === 'paid')"));
});
