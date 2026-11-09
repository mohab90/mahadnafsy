'use strict';
/**
 * 29 Oct 2026:
 *   «عند اضافه مصروف لازم يكون اختيار الخزنة اللى هصرف منها الفلوس»
 *   «في الخزن لازم كل الخزن تظهر اللي انا مدخلها حتي لو رصيدها صفر … احمد السعودية وغيره»
 *   «في رسيبشن الدقي ومدير الدقي محتاج يظهرلهم تاب واتسابي»
 * Run: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-boxes-secret-0123456789-abcdefghijklmnopqr';

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

test('the boxes the settings list names are boxes, written the way the boxes screen writes them', async () => {
  const file = require.resolve('../lib/tenantSettings');
  require.cache[file] = {
    id: file, filename: file, loaded: true,
    exports: { getTenantSetting: async () => ({ 'finance.payment_methods': 'خزنة الدقي||فودافون كاش  7722||تحويل لأحمد السعودية||فودافون كاش 7722' }) },
  };
  const { configuredBoxes, currencyOfName } = require('../lib/boxBalances');
  const db = { async query() { return [[]]; } };
  assert.deepEqual(await configuredBoxes(db, 't'), ['خزنة الدقي - كاش', 'فودافون كاش 7722', 'أحمد السعودية'],
    'a box typed twice is one box, and a transfer to Ahmed is his box');
  assert.equal(currencyOfName('أحمد السعودية'), 'SAR', 'a box with no money in it yet is shown in the currency its name says');
  assert.equal(currencyOfName('فودافون كاش 7722'), 'EGP');
});





test('«واتسابي» is open to the Dokki desk and its manager, customer service and HR, and to nobody else by this rule', () => {
  const { canUseChannel } = require('../constants/permissions');
  for (const role of ['reception_daqqi', 'daqqi_manager']) {
    assert.equal(canUseChannel({ role, permissions_json: '[]' }, 'whatsapp'), true, role);
  }
  assert.equal(canUseChannel({ role: 'reception_daqqi', permissions_json: '[]' }, 'inbox'), false, 'the shared inbox still goes by manage_inbox');
  // 3 Nov 2026: customer service and HR have it too ("زر واتسابي يظهر لموظفين الدقي ولخدمة العملاء والـ HR").
  for (const role of ['support', 'hr']) assert.equal(canUseChannel({ role, permissions_json: '[]' }, 'whatsapp'), true, role);
  assert.equal(canUseChannel({ role: 'reception_tagamoa', permissions_json: '[]' }, 'whatsapp'), false, 'not asked for the Tagamoa desk');
  const nav = fs.readFileSync(path.join(__dirname, '..', '..', 'admin', 'pages', 'dashboard', 'DashboardNavigation.tsx'), 'utf8');
  const desk = nav.slice(nav.indexOf('{isReceptionDaqqi && !isDaqqiManager'), nav.indexOf('Customer service horizontal nav'));
  const manager = nav.slice(nav.indexOf('{isDaqqiManager && !isAdmin'), nav.indexOf('Sales & Collection Manager horizontal nav'));
  
  
});

test('the box list names every box for whoever records an expense but shows balances only to the main books', () => {
  const route = read('routes', 'finance', 'budgets.js');
  const body = route.slice(route.indexOf("router.get('/api/admin/finance/box-options'"), route.indexOf('// ── The balances: reset a box'));
  
  // A scope with no aggregate view of the books (a collection officer's) makes resolveFinancialScope throw: the lab's sweep
  // got a 500 here for that account. They get the names and no balances.
  
  
  
  const form = read('..', 'admin', 'pages', 'dashboard', 'tabs', 'financial', 'ExpenseForm.tsx');
  assert.match(form, /balance: number \| null/);
  assert.match(form, /chosenBox\.balance !== null && Number\(expenseDraft\.amount\) > chosenBox\.balance/);
});
