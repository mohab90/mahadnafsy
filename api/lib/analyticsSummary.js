'use strict';

// «تقارير وإحصاءات تفصيلية» (admin/pages/dashboard/tabs/AnalyticsTab.tsx), counted on the server.
//
// The screen held the institute's orders, leads and clients in the browser and added them up there — for «إحصائيات
// الدقي» that meant every lead and every client of the system, pulled in 5,000-row pages, and for «الرئيسية» only the
// 500 newest of each, so the same screen said different things in the two places. The figures it draws are these:
// what was paid in the period and by type, the six months, what each course, track and therapist took, the leads by
// stage and source, the clients by month, branch and course. Money comes back per currency (the browser converts it
// with the rates the institute configured, as it always did); the rest are counts.
//
// The orders are what GET /api/admin/orders lists: the orders table, then every payment no order covers
// (routes/orders.js), so a desk payment counts as one.

const { addDaysToDateOnly } = require('./dates');

const RANGES = ['all', 'today', 'yesterday', '7d', '30d'];

/** The days a range covers, as { from, to } Cairo days (either null: unbounded). */
function rangeDays(range, today) {
  switch (range) {
    case 'today': return { from: today, to: today };
    case 'yesterday': return { from: addDaysToDateOnly(today, -1), to: addDaysToDateOnly(today, -1) };
    case '7d': return { from: addDaysToDateOnly(today, -7), to: null };
    case '30d': return { from: addDaysToDateOnly(today, -30), to: null };
    default: return { from: null, to: null };
  }
}
const inDays = (day, { from, to }) => (!from || day >= from) && (!to || day <= to);

/** The last six months, oldest first, as YYYY-MM (the current one last). */
function lastSixMonths(today) {
  const [year, month] = today.split('-').map(Number);
  return Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(year, month - 1 - (5 - i), 1)).toISOString().slice(0, 7));
}

/**
 * The orders as the dashboard reads them (normalizeOrders): lower-case status and type, the day the money counts on.
 * `orderRows`: { id, transaction_id, type, item_id, amount, currency, status, day, coupon_code } — `day` the Cairo day of
 * paid_at, else of created_at, worked out by the database (formatting 60,000 dates here cost five seconds);
 * `payRows`: { id, transaction_id, payment_type, course_id, bundle_id, amount, currency, status, day } with amount > 0,
 * `day` the payment's date (a payment's date names a day).
 */
function combineOrders(orderRows, payRows) {
  const ids = new Set(orderRows.map(row => row.id));
  const transactions = new Set(orderRows.map(row => row.transaction_id).filter(Boolean));
  const fromOrders = orderRows.map(row => ({
    status: String(row.status || 'paid').toLowerCase(), type: String(row.type || 'course').toLowerCase(),
    itemId: row.item_id || '', amount: Number(row.amount) || 0, currency: row.currency || 'EGP',
    day: row.day || '', coupon: row.coupon_code || '',
  }));
  const fromPayments = payRows
    .filter(row => !ids.has(row.id) && !(row.transaction_id && transactions.has(row.transaction_id)))
    .map(row => ({
      status: String(row.status || 'paid').toLowerCase(), type: String(row.payment_type || 'course').toLowerCase(),
      itemId: row.course_id || row.bundle_id || '', amount: Number(row.amount) || 0, currency: row.currency || 'EGP',
      day: row.day || '', coupon: '',
    }));
  return [...fromOrders, ...fromPayments];
}

/** What the screen draws of the orders: { pending, inRange: [{type,currency,amount,count}], monthly, items, coupons }. */
function summarizeOrders(orders, days, months) {
  const group = (rows, keyOf) => {
    const map = new Map();
    for (const row of rows) {
      const key = keyOf(row);
      const entry = map.get(key.join('|')) || { key, amount: 0, count: 0 };
      entry.amount += row.amount; entry.count += 1;
      map.set(key.join('|'), entry);
    }
    return [...map.values()];
  };
  const paid = orders.filter(row => row.status === 'paid');
  const coupons = {};
  for (const row of orders) if (row.coupon) coupons[row.coupon] = (coupons[row.coupon] || 0) + 1;
  return {
    pending: orders.filter(row => row.status === 'pending').length,
    inRange: group(paid.filter(row => inDays(row.day, days)), row => [row.type, row.currency])
      .map(({ key, amount, count }) => ({ type: key[0], currency: key[1], amount, count })),
    // Each of the six months: what was paid in it, per currency, and how many orders.
    monthly: months.map(month => ({
      month,
      orders: paid.filter(row => row.day.startsWith(month)).length,
      amounts: group(paid.filter(row => row.day.startsWith(month)), row => [row.currency]).map(({ key, amount }) => ({ currency: key[0], amount })),
    })),
    // What each course, track and therapist took, all time.
    items: group(paid.filter(row => ['course', 'bundle', 'consultation'].includes(row.type)), row => [row.type, row.itemId, row.currency])
      .map(({ key, amount }) => ({ type: key[0], itemId: key[1], currency: key[2], amount })),
    coupons,
  };
}

module.exports = { RANGES, rangeDays, lastSixMonths, combineOrders, summarizeOrders };
