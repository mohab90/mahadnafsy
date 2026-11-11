'use strict';
/**
 * 6 Nov 2026: the expenses table drew every row the server sent (up to 5,000) and the orders table stopped at row 300 with no way to reach the rest. Orders are drawn in steps
 * of 100; the expenses come from the server a page at a time with the totals the database adds up.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const admin = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', 'admin', ...parts), 'utf8');

test('the expenses screen asks the server for a page and for the figures, and adds nothing up from rows', () => {
  const table = admin('pages', 'dashboard', 'tabs', 'financial', 'ExpenseTable.tsx');
  assert.ok(table.includes('matchingCount'));
  assert.ok(table.includes('loadAllMatching()'), 'the CSV is of every matching expense, fetched when it is asked for');
  assert.equal(table.includes('reduce('), false, 'the table adds nothing up itself');
  const hook = admin('pages', 'dashboard', 'tabs', 'financial', 'useExpensesPage.ts');
  assert.ok(hook.includes('getExpensesPage'));
  assert.ok(hook.includes('wholeScope'), 'the full report and the PDF are of the whole scope, whatever the filter');
  const screen = admin('pages', 'dashboard', 'tabs', 'FinancialTab.tsx');
  assert.ok(screen.includes('expensePage.byCategory.reduce'), 'the category split is the database sums, converted at the screen rates');
  assert.equal(screen.includes('_allExpenses') || screen.includes('expenses.filter('), false, 'the screen no longer takes the whole list');
  const lists = admin('pages', 'dashboard', 'tabSiteLists.ts');
  assert.ok(lists.includes("financial: ['subscribers'],"), 'the financial tab downloads neither the expenses nor the orders');
  assert.ok(lists.includes('daqqi_accounting: [],'), 'nor does the branch\'s books');
});

test('the orders table is a page of the server\'s list: counts, totals and the export come from the database', () => {
  const source = admin('pages', 'dashboard', 'tabs', 'orders', 'OrdersAdminView.tsx');
  assert.equal(source.includes('slice(0, 300)'), false);
  assert.ok(source.includes('desk.pageCount') && source.includes('desk.setPage('), 'the table pages through the server\'s rows');
  assert.ok(source.includes('desk.fetchAll()'), 'the export fetches every row when it is clicked');
  assert.equal(source.includes('effectiveOrders'), false, 'the screen no longer holds the merged 500 + 500');
  const hook = admin('pages', 'dashboard', 'tabs', 'orders', 'useOrdersDesk.ts');
  assert.ok(hook.includes('mysqlAdmin.getOrdersPage('), 'the desk asks GET /api/admin/orders/page');
  assert.ok(hook.includes('ORDERS_PAGE_SIZE = 100'), 'pages of at most 100');
  assert.equal(admin('pages', 'dashboard', 'tabSiteLists.ts').includes("orders: ['orders'"), false, 'the orders tab no longer downloads the orders list');
});

test('the reps\' revenue on the sales hub and the staff performance screens is the database\'s, and neither downloads the orders to add it up', () => {
  for (const file of ['SalesHubTab.tsx', 'StaffPerformanceTab.tsx']) {
    const source = admin('pages', 'dashboard', 'tabs', file);
    assert.ok(source.includes('agg?.revenueEgp'), `${file} reads revenueEgp`);
    assert.equal(source.includes('orders.filter('), false, `${file} adds nothing up from orders`);
  }
  assert.equal(admin('pages', 'dashboard', 'tabs', 'SalesTeamTab.tsx').includes('orders.filter('), false);
  const lists = admin('pages', 'dashboard', 'tabSiteLists.ts');
  // 11 Nov 2026: the team and performance screens read the server's figures alone; the board keeps the page of leads only for its follow-ups list.
  for (const line of ["sales_hub: ['leads'],", 'sales_team: [],', 'staff_performance: [],']) assert.ok(lists.includes(line), line);
});

test('the accounts, AI and activity screens no longer download the orders; the accounts overview is the server\'s breakdown', () => {
  const tab = admin('pages', 'dashboard', 'tabs', 'FinancialTab.tsx');
  assert.ok(tab.includes('useRevenueBreakdown('));
  assert.equal(tab.includes('getPayments('), false, 'the screen no longer downloads up to 50,000 payments');
  assert.equal(tab.includes('allManualPayments'), false, 'nothing is added up from the clients\' loaded payment histories');
  assert.ok(tab.includes('ordersForExport'), 'the two reports ask for the orders when they are asked for');
  assert.equal(fs.existsSync(path.join(__dirname, '..', '..', 'admin', 'pages', 'dashboard', 'tabs', 'financial', 'useFinancialOrdersData.ts')), false, 'the browser-side revenue rows are gone');
  const ai = admin('pages', 'dashboard', 'tabs', 'AskAITab.tsx');
  assert.equal(ai.includes('orders.filter('), false, 'the AI screen counts no orders itself');
  assert.ok(ai.includes('getOverviewRevenue'), 'its money is the books\'');
  assert.equal(admin('pages', 'dashboard', 'tabs', 'ActivityTab.tsx').includes('listAllOrders(2000)'), true, 'the backup asks for the orders when it is clicked');
  const lists = admin('pages', 'dashboard', 'tabSiteLists.ts');
  assert.equal(/ask_ai: \[[^\]]*'orders'/.test(lists) || /activity: \[[^\]]*'orders'/.test(lists), false);
});

test('the AI screen is told counts the database made, and downloads no leads and no clients', () => {
  const ai = admin('pages', 'dashboard', 'tabs', 'AskAITab.tsx');
  assert.ok(ai.includes('getSubscriberFigures') && ai.includes('getLeadStats'));
  assert.equal(ai.includes('subscribers.filter(') || ai.includes('leads.filter(') || ai.includes('subscribers.flatMap('), false, 'nothing is counted out of a downloaded list');
  assert.ok(admin('pages', 'dashboard', 'tabSiteLists.ts').includes("ask_ai: ['settings'],"), 'the screen declares no lead or client list');
});

test('the marketing hub\'s audiences are the server\'s: opening it downloads no table', () => {
  assert.equal(admin('pages', 'dashboard', 'dashboardTabGroups.ts').includes("'marketing_hub',      // segmentation builds audiences from both tables"), false, 'marketing_hub is out of the full-load tab group');
  assert.ok(admin('pages', 'dashboard', 'tabSiteLists.ts').includes("marketing_hub: ['discounts', 'automationWorkflows']"), 'and loads neither the leads nor the clients');
  const tab = admin('pages', 'dashboard', 'tabs', 'marketing-hub-sections', 'SegmentationTab.tsx');
  assert.ok(tab.includes('mysqlAdmin.getLeadSegment('), 'the audience is asked of GET /api/admin/leads/segments');
  assert.equal(tab.includes('calcSegScore'), false, 'no score of the screen\'s own: the system\'s (leads.score)');
  assert.equal(tab.includes('leads.filter') || tab.includes('leads.map'), false, 'nothing is filtered out of a downloaded list');
});
