'use strict';

// «الاستبقاء», «مصادر الإيراد», «تحليل المصروفات» and «الميزانية مقابل الفعلي» added up the context's lists in the
// browser — the 500 newest orders, the clients of the list, the expenses — and the server adds them up now
// (GET /api/admin/analytics-hub/*, api/lib/analyticsScreens.js; the browser finishes them in
// admin/pages/dashboard/analyticsHubFigures.ts). This runs each screen's own code as it was on 19 Oct 2026 over the
// loaded lists and the new rule over the groups the database makes from the same rows, and compares what is drawn.
// The one change on purpose: money in a second currency was added to the pounds as if it were pounds; it is
// converted now, so the old code is run on amounts already converted.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'analytics-screens-test-secret-0123456789abcdef';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  lastMonths, rangeFrom, revenueGroups, revenueSources, expenseAnalysis, monthRevenue, retentionFigures,
} = require('../lib/analyticsScreens');
const { addDaysToDateOnly } = require('../lib/dates');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
const RATES = { EGP: 1, SAR: 13, USD: 48 };
const toEGP = (amount, currency) => amount * (RATES[currency] ?? 1);
const MONTHS6 = lastMonths(TODAY, 6);
const MONTHS12 = lastMonths(TODAY, 12);

// The browser file as it is, types stripped (the same way adminLoadsWhatTheScreenReads loads the lists).
function loadFigures() {
  const js = require('node:module').stripTypeScriptTypes(read('admin/pages/dashboard/analyticsHubFigures.ts')).replace(/^export /gm, '');
  const box = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', js + '\nmodule.exports = { revenueSourceFigures, expenseFigures, retentionView, monthRevenueEgp };')(box);
  return box.exports;
}
const { revenueSourceFigures, expenseFigures, retentionView, monthRevenueEgp } = loadFigures();

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
const next = random(20261019);
const pick = list => list[Math.floor(next() * list.length)];
const dayBack = back => addDaysToDateOnly(TODAY, -back);
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-6 * Math.max(1, Math.abs(expected)), `${label}: ${actual} vs ${expected}`);

// ── The rows ────────────────────────────────────────────────────────────────────────────────────────────────
const orderRows = Array.from({ length: 900 }, (_, i) => ({
  id: `o${i}`, transaction_id: pick([null, null, `tx${i}`, `shared${i % 40}`]), type: pick(['COURSE', 'COURSE', 'BUNDLE', 'CONSULTATION', 'OTHER']),
  course_id: pick(['c1', 'c2', 'c3', null]), bundle_id: pick([null, null, null, 'b1']), amount: pick([100, 250.5, 1000, 3000]),
  currency: pick(['EGP', 'EGP', 'SAR', 'USD']), status: pick(['PAID', 'PAID', 'PAID', 'PENDING', 'FAILED', 'REFUNDED']),
  lead_source: pick(['', '', 'facebook', 'instagram', 'whatsapp', 'google']), day: dayBack(Math.floor(next() * 220)),
}));
const payRows = Array.from({ length: 700 }, (_, i) => ({
  id: pick([`p${i}`, `p${i}`, `o${i % 900}`]), transaction_id: pick([null, null, `shared${i % 40}`, `tx${i}`]),
  payment_type: pick(['COURSE', 'CERTIFICATE', null, 'BOOK']), course_id: pick(['c1', 'c2', null]), bundle_id: pick([null, null, 'b1']),
  amount: pick([100, 500, 1500]), currency: pick(['EGP', 'SAR']), status: pick(['paid', 'paid', 'pending', null, 'refunded']),
  day: dayBack(Math.floor(next() * 220)),
}));

/** What GET /api/admin/orders gave the context: the orders, then the desk payments no order covers, normalizeOrders' shape. */
function loadedOrders() {
  const ids = new Set(orderRows.map(r => r.id));
  const transactions = new Set(orderRows.map(r => r.transaction_id).filter(Boolean));
  return [
    ...orderRows.map(r => ({ status: r.status.toLowerCase(), type: r.type.toLowerCase(), courseId: r.course_id || undefined, bundleId: r.bundle_id || undefined, amount: r.amount, currency: r.currency, createdAt: r.day, leadSource: r.lead_source || undefined, source: undefined })),
    ...payRows.filter(p => !ids.has(p.id) && !(p.transaction_id && transactions.has(p.transaction_id)))
      .map(p => ({ status: String(p.status || 'paid').toLowerCase(), type: (p.payment_type || 'course').toLowerCase(), courseId: p.course_id || undefined, bundleId: p.bundle_id || undefined, amount: p.amount, currency: p.currency, createdAt: p.day, leadSource: undefined, source: 'crm' })),
  ];
}

/** What the database makes of the same rows (routes/admin/analyticsscreens.js paidGroups): the paid ones, grouped. */
function groupedRows() {
  const group = (rows, keyOf) => {
    const map = new Map();
    for (const row of rows) {
      const key = keyOf(row);
      const id = JSON.stringify(key);
      const entry = map.get(id) || { ...key, amount: 0, n: 0 };
      entry.amount += row.amount; entry.n += 1;
      map.set(id, entry);
    }
    return [...map.values()];
  };
  const ids = new Set(orderRows.map(r => r.id));
  const transactions = new Set(orderRows.map(r => r.transaction_id).filter(Boolean));
  return {
    orders: group(orderRows.filter(r => r.status.toLowerCase() === 'paid'),
      r => ({ day: r.day, type: r.type.toLowerCase(), course_id: r.course_id, bundle_id: r.bundle_id, currency: r.currency, lead_source: r.lead_source })),
    payments: group(payRows.filter(p => String(p.status || 'paid').toLowerCase() === 'paid' && !ids.has(p.id) && !(p.transaction_id && transactions.has(p.transaction_id))),
      p => ({ day: p.day, type: String(p.payment_type || 'course').toLowerCase(), course_id: p.course_id, bundle_id: p.bundle_id, currency: p.currency })),
  };
}
const groups = () => { const { orders, payments } = groupedRows(); return revenueGroups(orders, payments); };

const byValue = list => [...list].sort((a, b) => (b.value - a.value) || a.name.localeCompare(b.name));
const COURSES = [{ id: 'c1', title: 'Course one' }, { id: 'c2', title: 'Course two' }];
const BUNDLES = [{ id: 'b1', title: 'Track one' }];
const productName = ({ courseId, bundleId, type }) => COURSES.find(c => c.id === courseId)?.title || BUNDLES.find(b => b.id === bundleId)?.title || type || 'أخرى';

// ── «مصادر الإيراد» ──────────────────────────────────────────────────────────────────────────────────────────
/** RevenueSourcesTab's memos, as they were, over the loaded orders (amounts converted first). */
function oldRevenueSources(orders, start) {
  const filteredOrders = orders.filter(o => o.status === 'paid' && (o.createdAt || '') >= start);
  const totalRevenue = filteredOrders.reduce((acc, o) => acc + (Number(o.amount) || 0), 0);
  const map = {};
  filteredOrders.forEach(o => { const source = o.leadSource || o.source || 'مباشر'; map[source] = (map[source] || 0) + (Number(o.amount) || 0); });
  const byLeadSource = Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  const types = { 'كورس': 0, 'باندل': 0, 'استشارة': 0, 'أخرى': 0 };
  filteredOrders.forEach(o => {
    if (o.bundleId) types['باندل'] += Number(o.amount) || 0;
    else if (o.courseId) types['كورس'] += Number(o.amount) || 0;
    else if (o.type === 'consultation') types['استشارة'] += Number(o.amount) || 0;
    else types['أخرى'] += Number(o.amount) || 0;
  });
  const byProductType = Object.entries(types).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
  const courses = {};
  filteredOrders.forEach(o => {
    const key = o.courseId || o.bundleId || o.type || 'other';
    const c = COURSES.find(c => c.id === o.courseId);
    const b = BUNDLES.find(b => b.id === o.bundleId);
    const name = c?.title || b?.title || o.courseName || o.type || 'أخرى';
    if (!courses[key]) courses[key] = { name, revenue: 0, count: 0 };
    courses[key].revenue += Number(o.amount) || 0;
    courses[key].count++;
  });
  const byCourse = Object.values(courses).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  const topSources = byLeadSource.slice(0, 3).map(s => s.name);
  const monthlyBySource = MONTHS6.map(m => {
    const mo = orders.filter(o => o.status === 'paid' && o.createdAt.slice(0, 7) === m);
    const entry = { month: m.slice(5) };
    topSources.forEach(src => { entry[src] = mo.filter(o => (o.leadSource || o.source || 'مباشر') === src).reduce((acc, o) => acc + (Number(o.amount) || 0), 0); });
    return entry;
  });
  return { totalRevenue, orderCount: filteredOrders.length, byLeadSource, byProductType, byCourse, topSources, monthlyBySource };
}

test('«مصادر الإيراد»: the server\'s groups give the figures the screen drew from the loaded orders, for every period', () => {
  const orders = loadedOrders().map(o => ({ ...o, amount: toEGP(o.amount, o.currency), currency: 'EGP' }));
  for (const monthsBack of [0, 3, 6, null]) {
    const start = monthsBack === null ? '2000-01-01' : `${lastMonths(TODAY, monthsBack + 1)[0]}-01`;
    const expected = oldRevenueSources(orders, start);
    const got = revenueSourceFigures(revenueSources(groups(), rangeFrom(start), MONTHS6), toEGP, productName);
    const label = String(monthsBack);
    near(got.totalRevenue, expected.totalRevenue, `revenue ${label}`);
    assert.equal(got.orderCount, expected.orderCount, `orders ${label}`);
    assert.deepEqual(got.byLeadSource.map(s => s.name), expected.byLeadSource.map(s => s.name), `sources ${label}`);
    byValue(got.byLeadSource).forEach((row, i) => near(row.value, byValue(expected.byLeadSource)[i].value, `source ${row.name}`));
    byValue(got.byProductType).forEach((row, i) => { assert.equal(row.name, byValue(expected.byProductType)[i].name); near(row.value, byValue(expected.byProductType)[i].value, `type ${row.name}`); });
    assert.equal(got.byCourse.length, expected.byCourse.length, `products ${label}`);
    got.byCourse.forEach((row, i) => { assert.equal(row.name, expected.byCourse[i].name); assert.equal(row.count, expected.byCourse[i].count); near(row.revenue, expected.byCourse[i].revenue, `product ${row.name}`); });
    assert.deepEqual(got.topSources, expected.topSources);
    got.monthlyBySource.forEach((row, i) => {
      assert.equal(row.month, expected.monthlyBySource[i].month);
      for (const source of expected.topSources) near(row[source], expected.monthlyBySource[i][source], `${source} in ${row.month}`);
    });
  }
  // The rows reach every branch of the rule: desk payments ('crm'), a lead source and none, the three money kinds.
  const all = oldRevenueSources(orders, '2000-01-01');
  assert.ok(all.byLeadSource.some(s => s.name === 'crm') && all.byLeadSource.some(s => s.name === 'مباشر') && all.byProductType.length === 4);
});

test('«مصادر الإيراد»: the server counts every paid order, the screen only saw the 500 newest', () => {
  const total = revenueSourceFigures(revenueSources(groups(), '2000-01-01', MONTHS6), toEGP, productName);
  const newest = loadedOrders().slice(0, 500).filter(o => o.status === 'paid');
  assert.ok(total.orderCount > newest.length, 'the fixtures hold more than the cap');
});

// ── «تحليل المصروفات» ────────────────────────────────────────────────────────────────────────────────────────
const expenses = Array.from({ length: 600 }, (_, i) => ({
  id: `e${i}`, category: pick(['RENT', 'SALARIES', 'MARKETING', 'OTHER', 'ODD']), currency: pick(['EGP', 'EGP', 'SAR']), amount: pick([300, 1200.5, 5000]), day: dayBack(Math.floor(next() * 220)),
}));
const LABELS = { RENT: 'إيجار', SALARIES: 'رواتب', MARKETING: 'تسويق', OTHER: 'أخرى' };
const labelOf = code => LABELS[code] || 'أخرى';

test('«تحليل المصروفات»: the server\'s groups give the figures the screen drew, for every period', () => {
  const sqlGroups = [];
  const seen = new Map();
  for (const e of expenses) {
    const key = `${e.day}|${e.category}|${e.currency}`;
    const entry = seen.get(key) || { day: e.day, category: e.category, currency: e.currency, amount: 0, n: 0 };
    entry.amount += e.amount; entry.n += 1; seen.set(key, entry);
  }
  sqlGroups.push(...seen.values());
  const orders = loadedOrders().map(o => ({ ...o, amount: toEGP(o.amount, o.currency) }));
  const list = expenses.map(e => ({ date: e.day, category: labelOf(e.category), amount: toEGP(e.amount, e.currency) }));
  for (const monthsBack of [0, 3, 6, null]) {
    const start = monthsBack === null ? '2000-01-01' : `${lastMonths(TODAY, monthsBack + 1)[0]}-01`;
    // ExpenseAnalyticsTab's memos
    const filtered = list.filter(e => e.date >= start);
    const totalExpenses = filtered.reduce((acc, e) => acc + e.amount, 0);
    const totalRevenue = orders.filter(o => o.status === 'paid' && o.createdAt >= start).reduce((acc, o) => acc + o.amount, 0);
    const netProfit = totalRevenue - totalExpenses;
    const profitMargin = totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100) : 0;
    const map = {};
    filtered.forEach(e => { map[e.category] = (map[e.category] || 0) + e.amount; });
    const byCategory = Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    const monthly = MONTHS6.map(m => ({
      month: m.slice(5),
      'مصروفات': list.filter(e => e.date.slice(0, 7) === m).reduce((acc, e) => acc + e.amount, 0),
      'إيراد': orders.filter(o => o.status === 'paid' && o.createdAt.slice(0, 7) === m).reduce((acc, o) => acc + o.amount, 0),
    }));

    const data = expenseAnalysis(sqlGroups, groups(), rangeFrom(start), MONTHS6, labelOf);
    const got = expenseFigures({ ...data, list: [] }, toEGP);
    assert.equal(data.expenses.count, filtered.length, `count ${monthsBack}`);
    near(got.totalExpenses, totalExpenses, 'expenses'); near(got.totalRevenue, totalRevenue, 'revenue'); near(got.netProfit, netProfit, 'net');
    assert.equal(got.profitMargin, profitMargin);
    assert.deepEqual(byValue(got.byCategory).map(c => c.name), byValue(byCategory).map(c => c.name));
    byValue(got.byCategory).forEach((row, i) => near(row.value, byValue(byCategory)[i].value, `category ${row.name}`));
    got.monthlyData.forEach((row, i) => {
      assert.equal(row.month, monthly[i].month);
      near(row['مصروفات'], monthly[i]['مصروفات'], `expenses of ${row.month}`); near(row['إيراد'], monthly[i]['إيراد'], `revenue of ${row.month}`);
    });
  }
  // An unknown stored category reads «أخرى», with the others of that name.
  assert.ok(expenses.some(e => e.category === 'ODD') && expenses.some(e => e.category === 'OTHER'));
});

// ── «متابعة الميزانية» ───────────────────────────────────────────────────────────────────────────────────────
test('«الميزانية مقابل الفعلي»: a month\'s revenue is the screen\'s, for each of the last twelve months', () => {
  // BudgetTrackerTab: the paid orders whose (paidAt || createdAt) fall in the month, summed (converted first).
  const orders = loadedOrders().map(o => ({ status: o.status, amount: toEGP(o.amount, o.currency), createdAt: `${o.createdAt}T12:00:00.000Z` }));
  for (const month of MONTHS12) {
    const [year, mo] = month.split('-').map(Number);
    const start = new Date(year, mo - 1, 1).toISOString();
    const end = new Date(year, mo, 0, 23, 59, 59).toISOString();
    const expected = orders.filter(o => o.status === 'paid' && o.createdAt >= start && o.createdAt <= end).reduce((s, o) => s + o.amount, 0);
    near(monthRevenueEgp(monthRevenue(groups(), month), toEGP), expected, `revenue of ${month}`);
  }
});

// ── «الاستبقاء» ──────────────────────────────────────────────────────────────────────────────────────────────
const subscribers = Array.from({ length: 800 }, (_, i) => {
  const created = dayBack(Math.floor(next() * 500));
  return {
    id: `s${i}`, clientStatus: pick([undefined, 'active', 'active', 'finished', 'paused', 'refunded', 'leads']),
    createdAt: created, updatedAt: pick([null, created, dayBack(Math.floor(next() * 300))]),
    enrolledCourseIds: pick([[], ['c1'], ['c1', 'c2'], ['c3'], ['c2', 'c3', 'c4']]),
  };
});
const paid = Object.fromEntries(subscribers.filter(() => next() < 0.7).map(s => [s.id, Math.round(next() * 9000)]));

test('«الاستبقاء»: the server\'s counts give the figures the screen drew from the loaded clients', () => {
  // RetentionTab's memos, as they were.
  const activeSubs = subscribers.filter(s => !['finished', 'paused', 'refunded', 'leads'].includes(s.clientStatus || ''));
  const monthlyNew = MONTHS12.map(m => ({
    month: m.slice(5),
    'جديد': subscribers.filter(s => s.createdAt.slice(0, 7) === m).length,
    'منتهي': subscribers.filter(s => s.clientStatus === 'finished' && (s.updatedAt || s.createdAt).slice(0, 7) === m).length,
  }));
  const courseMap = {};
  subscribers.forEach(s => s.enrolledCourseIds.forEach(cid => { courseMap[cid] = courseMap[cid] || { name: cid, count: 0 }; courseMap[cid].count++; }));
  const courseStats = Object.values(courseMap).sort((a, b) => b.count - a.count).slice(0, 8);
  const labels = { active: 'نشط', finished: 'منتهي', paused: 'متوقف', refunded: 'مسترد', leads: 'محول لليدات' };
  const statuses = {};
  subscribers.forEach(s => { const st = s.clientStatus || 'active'; statuses[st] = (statuses[st] || 0) + 1; });
  const statusBreakdown = Object.entries(statuses).map(([k, v]) => ({ name: labels[k] || k, value: v }));
  const retentionRate = Math.round((activeSubs.length / subscribers.length) * 100);
  const avgRevenue = Math.round(subscribers.reduce((acc, s) => acc + (paid[s.id] || 0), 0) / subscribers.length);

  // What the database makes of them
  const count = (rows, keyOf) => { const m = {}; rows.forEach(r => { const k = keyOf(r); m[k] = (m[k] || 0) + 1; }); return Object.entries(m); };
  const figures = retentionFigures({
    statusRows: count(subscribers, s => s.clientStatus || 'active').map(([status, n]) => ({ status, n })),
    createdRows: count(subscribers, s => s.createdAt.slice(0, 7)).map(([month, n]) => ({ month, n })),
    finishedRows: count(subscribers.filter(s => s.clientStatus === 'finished'), s => (s.updatedAt || s.createdAt).slice(0, 7)).map(([month, n]) => ({ month, n })),
    courseRows: count(subscribers.flatMap(s => s.enrolledCourseIds), cid => cid).map(([course_id, n]) => ({ course_id, n })),
    paidEgp: subscribers.reduce((acc, s) => acc + (paid[s.id] || 0), 0),
  }, MONTHS12);
  const got = retentionView(figures, id => id);

  assert.equal(got.total, subscribers.length);
  assert.equal(got.active, activeSubs.length);
  assert.equal(got.retentionRate, retentionRate);
  assert.equal(got.avgRevenue, avgRevenue);
  assert.deepEqual(got.monthlyNew, monthlyNew);
  assert.deepEqual(byValue(got.statusBreakdown), byValue(statusBreakdown));
  assert.deepEqual(got.courseStats.map(c => [c.name, c.count]).sort(), courseStats.map(c => [c.name, c.count]).sort());
  assert.ok(got.statusBreakdown.length === 5 && got.courseStats.length === 4 && monthlyNew.some(m => m['منتهي'] > 0));
  // Nothing: no clients is zero, not a division by zero.
  const none = retentionView(retentionFigures({ statusRows: [], createdRows: [], finishedRows: [], courseRows: [], paidEgp: 0 }, MONTHS12), id => id);
  assert.deepEqual([none.total, none.active, none.retentionRate, none.avgRevenue], [0, 0, 0, 0]);
});

test('the periods and the months are the screens\' own', () => {
  assert.equal(rangeFrom('2026-10-01'), '2026-10-01');
  assert.equal(rangeFrom('x; DROP TABLE'), '2000-01-01');
  assert.equal(rangeFrom(undefined), '2000-01-01');
  assert.equal(rangeFrom('2026-13-45'), '2000-01-01');
  assert.deepEqual(lastMonths('2026-02-15', 4), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.equal(MONTHS12.length, 12);
  assert.equal(MONTHS12[11], TODAY.slice(0, 7));
});

// ── The wiring ───────────────────────────────────────────────────────────────────────────────────────────────
test('every query names the tenant, every route is gated, and the desk payments an order covers are not counted twice', () => {
  const route = read('api/routes/admin/analyticsscreens.js');
  const queries = [...route.matchAll(/pool\.query\(\s*`([^`]*)`/g)].map(match => match[1]);
  assert.ok(queries.length >= 8);
  queries.forEach((sql, i) => assert.match(sql, /tenant_id/, `query ${i + 1} names no tenant`));
  assert.equal([...route.matchAll(/router\.get\('\/api\/admin\/analytics-hub\/[a-z-]+', requireAuth, requireAdminOrStaff, requirePermission\('view_financial'\)/g)].length, 4);
  assert.match(route, /LEFT JOIN orders x ON x\.id = p\.id AND x\.tenant_id = p\.tenant_id/);
  assert.match(route, /AND x\.id IS NULL/);
  assert.match(route, /p\.transaction_id NOT IN \(\s*SELECT y\.transaction_id FROM orders y/);
  assert.match(route, /financialScopeClause\(scope, \{ branchColumn: 'o\.branch_id'/);
  assert.match(route, /financialScopeClause\(scope, \{ branchColumn: 'p\.branch_id'/);
  assert.match(route, /scope\.kind === 'assigned_cs' \|\| scope\.kind === 'assigned_sales'\) return \{ groups: \[\], list: \[\] \}/);
  assert.match(route, /staffClientTools\.activeClientsBase\(req\)/);
  assert.match(route, /hasPermission\(req\.staffRecord, 'view_subscribers'\)/);
  assert.match(route, /ORDER BY e\.date DESC, e\.created_at DESC LIMIT 30/);
  assert.match(read('api/routes/admin.js'), /require\('\.\/admin\/analyticsscreens'\)/);
});

test('the four screens ask the server and hold no orders, expenses or clients', () => {
  for (const [file, hook] of [['RetentionTab', 'useRetention()'], ['RevenueSourcesTab', 'useRevenueSources('], ['ExpenseAnalyticsTab', 'useExpenseAnalysis('], ['BudgetTrackerTab', 'useMonthRevenue(']]) {
    const tab = read(`admin/pages/dashboard/tabs/${file}.tsx`);
    assert.ok(tab.includes(hook), `${file} does not ask the server`);
    assert.doesNotMatch(tab, /useFinanceData|usePaidBySubscriber|\borders\.filter|\bexpenses\.filter|\bsubscribers\.(?:filter|forEach|reduce)/, `${file} still adds up a list`);
    assert.doesNotMatch(tab, /\{[^}]*\b(?:orders|expenses|subscribers)\b[^}]*\}\s*=\s*use(?:SiteData|FinanceData)/, `${file} reads a list from the context`);
  }
  const lists = read('admin/pages/dashboard/tabSiteLists.ts');
  assert.match(lists, /\n  analytics_hub: \[\],/);
  assert.match(lists, /\n  financial_reports: \[\],/);
  // Nor does opening them page in every client of the institute.
  assert.doesNotMatch(read('admin/pages/dashboard/dashboardTabGroups.ts'), /export const fullSubscriberTabs = new Set<string>\(\[[\s\S]*?\n  'analytics_hub',[\s\S]*?\]\);/);
});
