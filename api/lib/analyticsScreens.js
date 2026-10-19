'use strict';

// The four admin-only analysis screens that held the context's whole lists and added them up in the browser:
// «الاستبقاء» (RetentionTab, the subscribers), «مصادر الإيراد» (RevenueSourcesTab, the orders), «تحليل المصروفات»
// (ExpenseAnalyticsTab, the expenses and the orders) and «الميزانية مقابل الفعلي» (BudgetTrackerTab, the month's
// orders). The database groups the rows (routes/admin/analyticsscreens.js); these are the rules that finish them.
// Money comes back per currency — the browser converts it with the rates the institute configured, as AnalyticsTab
// does — and the rest are counts. The lists the screens read were the 500 newest orders and clients, so these
// figures cover the whole tables.

const { isValidDateOnly } = require('./dates');

/** `count` months ending with the current one, oldest first, as YYYY-MM. */
function lastMonths(today, count) {
  const [year, month] = today.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(year, month - 1 - (count - 1 - i), 1)).toISOString().slice(0, 7));
}

/** The first day a range counts from (YYYY-MM-DD), 2000-01-01 for «الكل» and for anything that is not a day. */
const rangeFrom = value => (isValidDateOnly(value) ? String(value) : '2000-01-01');

/** Rows summed by a key: [{ key: [..], amount, count }]. */
function sumBy(rows, keyOf) {
  const map = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    const id = key.join('\u0001');
    const entry = map.get(id) || { key, amount: 0, count: 0 };
    entry.amount += row.amount; entry.count += row.count;
    map.set(id, entry);
  }
  return [...map.values()];
}
const moneyOf = entries => entries.map(({ key, amount }) => ({ currency: key[key.length - 1], amount }));

/**
 * The paid orders as the dashboard reads them (normalizeOrders): `orderRows` the orders table and `payRows` the desk
 * payments no order covers, each already grouped by the database (day, type, course, bundle, currency, source) with
 * `amount` the sum and `n` the number of rows. `day` is the Cairo day the money counts on. A payment has no lead source
 * of its own: the screens read `leadSource || source`, and a desk payment's `source` is «crm».
 */
function revenueGroups(orderRows, payRows) {
  const asGroup = (row, source) => ({
    day: row.day || '', type: String(row.type || 'course').toLowerCase(), courseId: row.course_id || '', bundleId: row.bundle_id || '',
    source, currency: row.currency || 'EGP', amount: Number(row.amount) || 0, count: Number(row.n) || 0,
  });
  return [
    ...orderRows.map(row => asGroup(row, row.lead_source || 'مباشر')),
    ...payRows.map(row => asGroup(row, 'crm')),
  ];
}

/** «مصادر الإيراد»: what was paid since `from` by source and by product, and the last months by source. */
function revenueSources(groups, from, months) {
  const inRange = groups.filter(group => group.day >= from);
  const inMonths = groups.filter(group => months.includes(group.day.slice(0, 7)));
  return {
    from, months,
    bySource: sumBy(inRange, group => [group.source, group.currency])
      .map(({ key, amount, count }) => ({ source: key[0], currency: key[1], amount, count })),
    byProduct: sumBy(inRange, group => [group.courseId, group.bundleId, group.type, group.currency])
      .map(({ key, amount, count }) => ({ courseId: key[0], bundleId: key[1], type: key[2], currency: key[3], amount, count })),
    monthly: sumBy(inMonths, group => [group.day.slice(0, 7), group.source, group.currency])
      .map(({ key, amount }) => ({ month: key[0], source: key[1], currency: key[2], amount })),
  };
}

/** The money paid in each of `months`, per currency. */
function monthlyRevenue(groups, months) {
  return months.map(month => ({
    month, amounts: moneyOf(sumBy(groups.filter(group => group.day.slice(0, 7) === month), group => [group.currency])),
  }));
}

/**
 * «تحليل المصروفات»: the expenses since `from` by category, the six months of expenses and of revenue, the revenue since
 * `from`. `expenseRows`: { day, category (the stored code), currency, amount, n }, `labelOf` the code's label.
 */
function expenseAnalysis(expenseRows, groups, from, months, labelOf) {
  const expenses = expenseRows.map(row => ({
    day: row.day || '', category: labelOf(row.category) || 'أخرى', currency: row.currency || 'EGP',
    amount: Number(row.amount) || 0, count: Number(row.n) || 0,
  }));
  const inRange = expenses.filter(expense => expense.day >= from);
  return {
    from, months,
    expenses: {
      count: inRange.reduce((total, expense) => total + expense.count, 0),
      byCategory: sumBy(inRange, expense => [expense.category, expense.currency])
        .map(({ key, amount }) => ({ category: key[0], currency: key[1], amount })),
      monthly: monthlyExpenses(expenses, months),
    },
    revenue: {
      inRange: moneyOf(sumBy(groups.filter(group => group.day >= from), group => [group.currency])),
      monthly: monthlyRevenue(groups, months),
    },
  };
}
function monthlyExpenses(expenses, months) {
  return months.map(month => ({
    month, amounts: moneyOf(sumBy(expenses.filter(expense => expense.day.slice(0, 7) === month), expense => [expense.currency])),
  }));
}

/** «متابعة الميزانية»: what was paid in `month` (YYYY-MM), per currency. */
function monthRevenue(groups, month) {
  return moneyOf(sumBy(groups.filter(group => group.day.slice(0, 7) === month), group => [group.currency]));
}

/**
 * «الاستبقاء»: the clients by status, by month joined and finished, by course, and what they paid in all.
 * `statusRows`: { status, n } (the stored status, 'active' for none); `createdRows` / `finishedRows`: { month, n };
 * `courseRows`: { course_id, n } (clients with the course active); `paidEgp` the net EGP the clients paid.
 */
function retentionFigures({ statusRows, createdRows, finishedRows, courseRows, paidEgp }, months) {
  const byStatus = {};
  let total = 0;
  for (const row of statusRows) { byStatus[row.status] = (byStatus[row.status] || 0) + Number(row.n); total += Number(row.n); }
  const created = Object.fromEntries(createdRows.map(row => [row.month, Number(row.n)]));
  const finished = Object.fromEntries(finishedRows.map(row => [row.month, Number(row.n)]));
  return {
    months, total, byStatus,
    monthly: months.map(month => ({ month, created: created[month] || 0, finished: finished[month] || 0 })),
    perCourse: Object.fromEntries(courseRows.map(row => [row.course_id, Number(row.n)])),
    paidEgp: Number(paidEgp) || 0,
  };
}

module.exports = { lastMonths, rangeFrom, revenueGroups, revenueSources, monthlyRevenue, expenseAnalysis, monthRevenue, retentionFigures };
