'use strict';

// «تقارير وإحصاءات تفصيلية» added up the institute's orders in the browser; the server adds them up now
// (GET /api/admin/analytics-summary, api/lib/analyticsSummary.js). The orders are what GET /api/admin/orders lists —
// the orders table, then every payment no order covers — and the figures are the screen's own: what was paid in the
// period and by type, the six months, what each course, track and therapist took, the coupons used. This runs the
// screen's code as it was on 19 Oct 2026 (AnalyticsTab, over the loaded orders) and the server's on the same rows.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'analytics-summary-test-secret-0123456789abcdef';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { combineOrders, summarizeOrders, rangeDays, lastSixMonths, RANGES } = require('../lib/analyticsSummary');
const { addDaysToDateOnly } = require('../lib/dates');

const ROOT = path.join(__dirname, '..', '..');
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
const RATES = { EGP: 1, SAR: 13, USD: 48 };
const toEGP = (amount, currency) => amount * (RATES[currency] ?? 1);

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rows() {
  const next = random(20261019);
  const pick = list => list[Math.floor(next() * list.length)];
  const day = back => addDaysToDateOnly(TODAY, -back);
  const orderRows = Array.from({ length: 900 }, (_, i) => {
    const d = day(Math.floor(next() * 200));
    return {
      id: `o${i}`, transaction_id: pick([null, null, `tx${i}`, `shared${i % 40}`]), type: pick(['COURSE', 'COURSE', 'BUNDLE', 'CONSULTATION', 'OTHER']),
      item_id: pick(['c1', 'c2', 'b1', 't1', '']), amount: pick([100, 250.5, 1000, 3000]), currency: pick(['EGP', 'EGP', 'SAR', 'USD']),
      status: pick(['PAID', 'PAID', 'PENDING', 'FAILED', 'REFUNDED']), coupon_code: pick([null, null, 'SAVE10', 'EID']),
      // the Cairo day the database worked out: paid on that day, or created on it
      day: d,
    };
  });
  const payRows = Array.from({ length: 700 }, (_, i) => ({
    id: pick([`p${i}`, `p${i}`, `o${i % 900}`]), transaction_id: pick([null, null, `shared${i % 40}`, `tx${i}`]),
    payment_type: pick(['COURSE', 'CERTIFICATE', null, 'BOOK']), course_id: pick(['c1', 'c2', null]), bundle_id: pick([null, null, 'b1']),
    amount: pick([100, 500, 1500]), currency: pick(['EGP', 'SAR']), status: pick(['paid', 'paid', 'pending', 'failed', 'refunded']),
    day: day(Math.floor(next() * 200)),
  }));
  return { orderRows, payRows };
}

/** The screen's own code over the loaded orders: normalizeOrders' shape, then AnalyticsTab's rules. */
function screenRun(orderRows, payRows, range) {
  const existingIds = new Set(orderRows.map(r => r.id));
  const existingTxn = new Set(orderRows.map(r => r.transaction_id).filter(Boolean));
  const orders = [
    ...orderRows.map(r => ({ status: r.status.toLowerCase(), type: r.type.toLowerCase(), itemId: r.item_id, amount: r.amount, currency: r.currency, createdAt: r.day, couponCode: r.coupon_code || undefined })),
    ...payRows.filter(p => !existingIds.has(p.id) && !(p.transaction_id && existingTxn.has(p.transaction_id)))
      .map(p => ({ status: p.status, type: (p.payment_type || 'course').toLowerCase(), itemId: p.course_id || p.bundle_id || '', amount: p.amount, currency: p.currency, createdAt: p.day })),
  ];
  const inRange = (dateStr) => {
    if (range === 'all') return true;
    const d = dateStr;
    if (!d) return false;
    if (range === 'today') return d === TODAY;
    if (range === 'yesterday') return d === addDaysToDateOnly(TODAY, -1);
    if (range === '7d') return d >= addDaysToDateOnly(TODAY, -7);
    if (range === '30d') return d >= addDaysToDateOnly(TODAY, -30);
    return true;
  };
  const allPaid = orders.filter(o => o.status === 'paid');
  const filteredOrders = allPaid.filter(o => inRange(o.createdAt));
  const sum = list => list.reduce((s, o) => s + toEGP(o.amount, o.currency), 0);
  const months = lastSixMonths(TODAY);
  return {
    pending: orders.filter(o => o.status === 'pending').length,
    count: filteredOrders.length, total: sum(filteredOrders),
    byType: { course: sum(filteredOrders.filter(o => o.type === 'course')), bundle: sum(filteredOrders.filter(o => o.type === 'bundle')), consultation: sum(filteredOrders.filter(o => o.type === 'consultation')) },
    monthly: months.map(ms => { const mo = allPaid.filter(o => o.createdAt.startsWith(ms)); return { month: ms, rev: sum(mo), orders: mo.length }; }),
    course: id => sum(allPaid.filter(o => o.type === 'course' && o.itemId === id)),
    bundle: id => sum(allPaid.filter(o => o.type === 'bundle' && o.itemId === id)),
    consultation: id => sum(allPaid.filter(o => o.type === 'consultation' && o.itemId === id)),
    coupons: orders.reduce((acc, o) => (o.couponCode ? { ...acc, [o.couponCode]: (acc[o.couponCode] || 0) + 1 } : acc), {}),
  };
}

test('the orders\' figures come out of the server as they did out of the loaded list, for every range', () => {
  const { orderRows, payRows } = rows();
  const money = list => list.reduce((s, m) => s + toEGP(m.amount, m.currency), 0);
  for (const range of RANGES) {
    const expected = screenRun(orderRows, payRows, range);
    const got = summarizeOrders(combineOrders(orderRows, payRows), rangeDays(range, TODAY), lastSixMonths(TODAY));
    assert.equal(got.pending, expected.pending, `pending ${range}`);
    assert.equal(got.inRange.reduce((s, r) => s + r.count, 0), expected.count, `orders ${range}`);
    assert.ok(Math.abs(money(got.inRange) - expected.total) < 0.01, `revenue ${range}`);
    for (const type of ['course', 'bundle', 'consultation']) {
      assert.ok(Math.abs(money(got.inRange.filter(r => r.type === type)) - expected.byType[type]) < 0.01, `${type} ${range}`);
    }
    got.monthly.forEach((month, index) => {
      assert.equal(month.month, expected.monthly[index].month);
      assert.equal(month.orders, expected.monthly[index].orders, `orders of ${month.month}`);
      assert.ok(Math.abs(money(month.amounts) - expected.monthly[index].rev) < 0.01, `revenue of ${month.month}`);
    });
  }
  const expected = screenRun(orderRows, payRows, 'all');
  const got = summarizeOrders(combineOrders(orderRows, payRows), rangeDays('all', TODAY), lastSixMonths(TODAY));
  const item = (type, id) => got.items.filter(r => r.type === type && r.itemId === id).reduce((s, r) => s + toEGP(r.amount, r.currency), 0);
  for (const id of ['c1', 'c2']) assert.ok(Math.abs(item('course', id) - expected.course(id)) < 0.01, `course ${id}`);
  assert.ok(Math.abs(item('bundle', 'b1') - expected.bundle('b1')) < 0.01);
  assert.ok(Math.abs(item('consultation', 't1') - expected.consultation('t1')) < 0.01);
  assert.deepEqual(got.coupons, expected.coupons);
  // The fixtures reach the rule: money in every currency, a payment an order covers, pending ones, a month with none.
  assert.ok(got.pending > 0 && got.inRange.length > 3 && Object.keys(got.coupons).length === 2);
  assert.ok(payRows.some(p => orderRows.some(o => o.id === p.id)) && payRows.some(p => orderRows.some(o => o.transaction_id && o.transaction_id === p.transaction_id)));
});

test('a payment an order covers is one sale, not two', () => {
  const orders = [{ id: 'o1', transaction_id: 'tx1', type: 'COURSE', item_id: 'c1', amount: 100, currency: 'EGP', status: 'PAID', day: TODAY, coupon_code: null }];
  const payments = [
    { id: 'o1', transaction_id: null, payment_type: 'COURSE', course_id: 'c1', bundle_id: null, amount: 100, currency: 'EGP', status: 'paid', day: TODAY },
    { id: 'p2', transaction_id: 'tx1', payment_type: 'COURSE', course_id: 'c1', bundle_id: null, amount: 100, currency: 'EGP', status: 'paid', day: TODAY },
    { id: 'p3', transaction_id: null, payment_type: null, course_id: null, bundle_id: 'b1', amount: 40, currency: 'SAR', status: 'paid', day: TODAY },
  ];
  const all = combineOrders(orders, payments);
  assert.equal(all.length, 2, 'the order and the one desk payment');
  assert.deepEqual(all[1], { status: 'paid', type: 'course', itemId: 'b1', amount: 40, currency: 'SAR', day: TODAY, coupon: '' });
});

test('the endpoint counts what the person may see and leaves the rest null', () => {
  const route = fs.readFileSync(path.join(ROOT, 'api/routes/admin/analyticssummary.js'), 'utf8');
  assert.match(route, /orders: may\('view_orders'\) \? await ordersSection\(req, days, months\) : null,/);
  assert.match(route, /leads: may\('view_leads'\) \? await leadsSection\(req, days\) : null,/);
  assert.match(route, /subscribers: may\('view_subscribers'\) \? await clientsSection\(req, days, months\) : null,/);
  // The same scopes the lists applied: the lead scope, the financial scope, the client list's population.
  assert.match(route, /leadScope\(req, 'l'\)/);
  assert.match(route, /resolveFinancialScope\(req, \{ requestedBranch: null, allowAssigned: true \}\)/);
  assert.match(route, /staffClientTools\.activeClientsBase\(req\)/);
  assert.match(route, /l\.hidden = 0/);
  assert.match(fs.readFileSync(path.join(ROOT, 'api/routes/admin.js'), 'utf8'), /require\('\.\/admin\/analyticssummary'\)/);
});

test('the screen asks the server and holds no orders, leads or clients', () => {
  const tab = fs.readFileSync(path.join(ROOT, 'admin/pages/dashboard/tabs/AnalyticsTab.tsx'), 'utf8');
  assert.match(tab, /useAnalyticsSummary\(timeRange\)/);
  assert.match(tab, /useEnsureSiteLists\(\['discounts', 'contactMessages'\]\)/);
  assert.doesNotMatch(tab, /\n\s+orders, leads,|subscribers\.filter|leads\.filter|orders\.filter/);
});
