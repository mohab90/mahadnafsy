'use strict';

// What the budget screen («الميزانية مقابل الفعلي», BudgetTrackerTab) still asks of the server: the month's paid money, per currency. The database groups the
// rows (routes/admin/analyticsscreens.js); these are the rules that finish them. The analyses of retention, revenue sources and expenses went with their
// pages on 5 Nov 2026.

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

/** «متابعة الميزانية»: what was paid in `month` (YYYY-MM), per currency. */
function monthRevenue(groups, month) {
  return moneyOf(sumBy(groups.filter(group => group.day.slice(0, 7) === month), group => [group.currency]));
}

module.exports = { revenueGroups, monthRevenue };
