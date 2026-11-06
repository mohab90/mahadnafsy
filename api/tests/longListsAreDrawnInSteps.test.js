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
  assert.ok(lists.includes("financial: ['orders', 'subscribers'],"), 'the financial tab no longer downloads the expenses');
  assert.ok(lists.includes('daqqi_accounting: [],'), 'nor does the branch\'s books');
});

test('the orders table no longer stops at 300: it offers the rest', () => {
  const source = admin('pages', 'dashboard', 'tabs', 'orders', 'OrdersAdminView.tsx');
  assert.equal(source.includes('slice(0, 300)'), false);
  assert.ok(source.includes('tabRows.slice(0, shownOrders)'));
  assert.ok(source.includes('setShownOrders(tabRows.length)'));
  assert.ok(source.includes('exportFilteredOrdersCsv(tabRows)'), 'the export is of every row');
});
