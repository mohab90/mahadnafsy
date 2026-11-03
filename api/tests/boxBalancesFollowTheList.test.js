'use strict';
/**
 * 3 Nov 2026, the boxes' balances read through the settings list (lib/boxCatalog.js): the 2,316 SAR typed on «فودافون كاش 4645» is the riyal box's, an opening
 * typed under a stray spelling lands in its listed box, and money on a box nobody listed sits under «أخرى».
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const file = require.resolve('../lib/tenantSettings');
require.cache[file] = {
  id: file, filename: file, loaded: true,
  exports: { getTenantSetting: async () => ({ 'finance.payment_methods': 'خزنة الدقي - كاش||فودافون كاش 4645||ويسترن يونيون||تحويل لأحمد السعودية||فودافون كاش 7722' }) },
};
const { currentBalances } = require('../lib/boxBalances');

const db = {
  async query(sql) {
    if (/FROM box_aliases/.test(sql)) return [[]];
    if (/FROM box_balances/.test(sql)) {
      return [[
        { method: 'فودافون كاش 4645', currency: 'SAR', opening_amount: 100, baseline_at: null },
        { method: 'فودافون كاش  7722', currency: 'EGP', opening_amount: 50, baseline_at: null },
        { method: 'فودافون كاش 1111', currency: 'EGP', opening_amount: 5, baseline_at: null },
      ]];
    }
    if (/FROM payments p/.test(sql)) {
      return [[
        { method: 'فودافون كاش 4645', currency: 'SAR', total: 2316 },
        { method: 'نقدي', currency: 'EGP', total: 1000 },
        { method: 'فودافون كاش 7722', currency: 'EGP', total: 400 },
        { method: 'Paymob', currency: 'EGP', total: 70 },
        { method: 'غير محدد', currency: 'EGP', total: 30 },
        { method: 'ويسترن', currency: 'USD', total: 25 },
      ]];
    }
    return [[]];
  },
};

test('balances follow the list: riyals on the riyal box, an unlisted box under «أخرى», a stray spelling in its listed box', async () => {
  const balances = await currentBalances(db, { tenantId: 't' });
  const of = key => balances.get(key)?.balance;
  assert.equal(of('أحمد السعودية|SAR'), 2416, 'the 2,316 SAR from the Vodafone wallet and the 100 typed on it');
  assert.equal(balances.has('فودافون كاش 4645|SAR'), false, 'no Vodafone box in riyals');
  assert.equal(of('خزنة الدقي - كاش|EGP'), 1000);
  assert.equal(of('فودافون كاش 7722|EGP'), 450, 'the opening typed with two spaces and the payments are one box');
  assert.equal(of('أخرى|EGP'), 105, 'Paymob 70 + undefined 30 + an unlisted wallet\'s opening 5');
  assert.equal(of('ويسترن يونيون|USD'), 25);
});
