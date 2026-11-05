'use strict';
/**
 * 6 Nov 2026: the expenses table drew every row the server sent (up to 5,000) and the orders table stopped at row 300 with no way to reach the rest. Both are drawn in steps
 * of 100 with «عرض ١٠٠ كمان» / «عرض الكل», and the totals and exports still read the whole list.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const admin = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', 'admin', ...parts), 'utf8');

test('the expense table draws a step of rows, and its total and CSV are of the whole list', () => {
  const source = admin('pages', 'dashboard', 'tabs', 'financial', 'ExpenseTable.tsx');
  assert.match(source, /useShownRows\(filteredExpenses, 100\)/);
  assert.match(source, /\{shown\.map\(/);
  assert.equal(source.includes('{filteredExpenses.map('), false, 'no row is drawn from the whole list');
  assert.match(source, /filteredExpenses\.map\(\(expense\) => \[operationNo/, 'the CSV is built from every expense');
  assert.match(source, /عرض الكل/);
});

test('the orders table no longer stops at 300: it offers the rest', () => {
  const source = admin('pages', 'dashboard', 'tabs', 'orders', 'OrdersAdminView.tsx');
  assert.equal(source.includes('slice(0, 300)'), false);
  assert.match(source, /tabRows\.slice\(0, shownOrders\)/);
  assert.match(source, /setShownOrders\(tabRows\.length\)/);
  assert.match(source, /exportFilteredOrdersCsv\(tabRows\)/, 'the export is of every row');
});

test('the stepping hook starts at one step, grows by a step, and starts over when the list changes', () => {
  const source = admin('hooks', 'useShownRows.ts');
  assert.match(source, /useState\(step\)/);
  assert.match(source, /current \+ step/);
  assert.match(source, /setCount\(step\)/);
});
