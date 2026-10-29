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

test('the boxes screen lists a box at zero, and a box that has not seen a payment lately', () => {
  const route = read('routes', 'finance', 'budgets.js');
  assert.doesNotMatch(route, /value\.balance !== 0/, 'a box was left off the screen when its balance was zero');
  assert.match(route, /for \(const name of await configuredBoxes\(pool, req\.tenantId\)\)/);
  // A branch sees only its own clients' money, which has no boxes of its own.
  assert.match(route, /if \(!scope\.branchId\) \{\s*const current = await currentBalances/);
});

test('an expense must name its box, and its amount comes out of that box', () => {
  const route = read('routes', 'admin-operations.js');
  assert.match(route, /code: 'EXPENSE_BOX_REQUIRED'/);
  assert.match(route, /box_method, created_at\)\s+VALUES \(\?,\?,\?,\?,\?,\?,\?,\?,\?,\?,\?,\?,\?,\?,NOW\(\)\)/);
  assert.match(route, /SET description=\?, amount=\?, currency=\?, category=\?, date=\?, receipt_url=\?, note=\?, branch_id=\?, expense_no=\?, box_method=\?/);
  assert.match(read('migrations', '346_v26_expense_box.sql'), /ALTER TABLE expenses ADD COLUMN IF NOT EXISTS box_method VARCHAR\(191\)/);
  assert.match(read('lib', 'boxBalances.js'), /FROM expenses[\s\S]{0,200}box_method IS NOT NULL/);
  const form = fs.readFileSync(path.join(__dirname, '..', '..', 'admin', 'pages', 'dashboard', 'tabs', 'financial', 'ExpenseForm.tsx'), 'utf8');
  assert.match(form, /\/api\/admin\/finance\/box-options/);
  assert.match(form, /\(!needsBox \|\| !!expenseDraft\.boxMethod\)/, 'the form will not save a new expense with no box');
});

test('«واتسابي» is open to the Dokki desk and its manager, and to nobody else by this rule', () => {
  const { canUseChannel } = require('../constants/permissions');
  for (const role of ['reception_daqqi', 'daqqi_manager']) {
    assert.equal(canUseChannel({ role, permissions_json: '[]' }, 'whatsapp'), true, role);
  }
  assert.equal(canUseChannel({ role: 'reception_daqqi', permissions_json: '[]' }, 'inbox'), false, 'the shared inbox still goes by manage_inbox');
  assert.equal(canUseChannel({ role: 'reception_tagamoa', permissions_json: '[]' }, 'whatsapp'), false, 'not asked for the Tagamoa desk');
  const nav = fs.readFileSync(path.join(__dirname, '..', '..', 'admin', 'pages', 'dashboard', 'DashboardNavigation.tsx'), 'utf8');
  const desk = nav.slice(nav.indexOf('{isReceptionDaqqi && !isDaqqiManager'), nav.indexOf('Customer service horizontal nav'));
  const manager = nav.slice(nav.indexOf('{isDaqqiManager && !isAdmin'), nav.indexOf('Sales & Collection Manager horizontal nav'));
  assert.match(desk, /key: 'whatsapp_web'/);
  assert.match(manager, /key: 'whatsapp_web'/);
});
