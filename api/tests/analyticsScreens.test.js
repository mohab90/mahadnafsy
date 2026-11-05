'use strict';

// «الميزانية مقابل الفعلي» asks the server for the month's paid money (GET /api/admin/analytics-hub/month-revenue, api/lib/analyticsScreens.js).
// The analyses of retention, revenue sources and expenses went with their pages on 5 Nov 2026 — this pins what is left and that nothing of them is.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'analytics-screens-test-secret-0123456789abcdef';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { revenueGroups, monthRevenue } = require('../lib/analyticsScreens');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('a month\'s revenue is the paid orders and the desk payments no order covers, per currency', () => {
  const groups = revenueGroups(
    [{ day: '2026-10-03', type: 'course', course_id: 'c1', currency: 'EGP', lead_source: 'facebook', amount: 1000, n: 2 },
      { day: '2026-10-20', type: 'course', course_id: 'c2', currency: 'SAR', lead_source: '', amount: 300, n: 1 },
      { day: '2026-09-30', type: 'course', course_id: 'c1', currency: 'EGP', lead_source: '', amount: 500, n: 1 }],
    [{ day: '2026-10-05', type: 'course', course_id: 'c1', currency: 'EGP', amount: 250, n: 1 }]);
  assert.deepEqual(monthRevenue(groups, '2026-10').sort((a, b) => a.currency.localeCompare(b.currency)), [{ currency: 'EGP', amount: 1250 }, { currency: 'SAR', amount: 300 }]);
  assert.deepEqual(monthRevenue(groups, '2026-09'), [{ currency: 'EGP', amount: 500 }]);
  assert.deepEqual(monthRevenue(groups, '2026-08'), []);
  assert.equal(groups.find(group => group.currency === 'SAR').source, 'مباشر', 'an order with no lead source is direct');
  assert.equal(groups.at(-1).source, 'crm', 'a desk payment is crm');
});

test('the one route left names the tenant, is gated, and does not count a desk payment an order covers twice', () => {
  const route = read('api/routes/admin/analyticsscreens.js');
  const queries = [...route.matchAll(/pool\.query\(\s*`([^`]*)`/g)].map(match => match[1]);
  assert.equal(queries.length, 2);
  queries.forEach((sql, i) => assert.match(sql, /tenant_id/, `query ${i + 1} names no tenant`));
  assert.equal([...route.matchAll(/router\.get\('\/api\/admin\/analytics-hub\/[a-z-]+', requireAuth, requireAdminOrStaff, requirePermission\('view_financial'\)/g)].length, 1);
  assert.match(route, /LEFT JOIN orders x ON x\.id = p\.id AND x\.tenant_id = p\.tenant_id/);
  assert.match(route, /AND x\.id IS NULL/);
  assert.match(route, /p\.transaction_id NOT IN \(\s*SELECT y\.transaction_id FROM orders y/);
  assert.match(route, /financialScopeClause\(scope, \{ branchColumn: 'o\.branch_id'/);
  assert.match(route, /financialScopeClause\(scope, \{ branchColumn: 'p\.branch_id'/);
  assert.match(read('api/routes/admin.js'), /require\('\.\/admin\/analyticsscreens'\)/);
});

test('the retired analyses are gone: no route, no page, no hook, no menu entry', () => {
  const route = read('api/routes/admin/analyticsscreens.js');
  for (const gone of ['revenue-sources', 'expense-analysis', 'retention']) assert.ok(!route.includes(`analytics-hub/${gone}`), gone);
  for (const file of ['AnalyticsHubTab', 'RetentionTab', 'CohortAnalysisTab', 'RevenueSourcesTab', 'ExpenseAnalyticsTab']) {
    assert.ok(!fs.existsSync(path.join(ROOT, 'admin/pages/dashboard/tabs', `${file}.tsx`)), `${file} is still there`);
  }
  assert.doesNotMatch(read('admin/pages/dashboard/navigation.tsx'), /analytics_hub/);
  assert.match(read('admin/pages/dashboard/tabUrlAliases.ts'), /analytics_hub: 'kpi_dashboard'/, 'an old link lands on the KPI page');
  const budget = read('admin/pages/dashboard/tabs/BudgetTrackerTab.tsx');
  assert.ok(budget.includes('useMonthRevenue('), 'the budget screen asks the server');
});
