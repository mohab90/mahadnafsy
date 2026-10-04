'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canonicalChannel, CASH_BOX } = require('../lib/paymentChannels');

test('the channels the accounts screen listed collapse to one name per box', () => {
  // The list as it appeared under «القناة» (owner, 4 Oct 2026).
  const listed = ['خزنة الدقي - كاش', 'انستا باي 7720', 'فودافون كاش 2020', 'فودفوان كاس 1010', 'فودافون كاش 2526',
    'فودافون كاش 7711', 'فودافون كاش 7722', 'فودافون كاش 4645', 'محفظة وي 7720', 'تحويل لأحمد السعودية',
    'فودافون كاش', 'انستا باي', 'احمد السعودية', 'تحويل بنكي', 'فودافون كاش‏ 7722', 'فودافون كاش 1079', 'أخرى',
    'فودافون كاش 2362', 'اورانج كاش 7720', 'خزنة الدقي', 'فودافون  كاش 4645', 'وي باي 7720', 'كاش'];
  const merged = [...new Set(listed.map(canonicalChannel))];
  assert.deepEqual(merged.sort(), [
    'أحمد السعودية', 'أخرى', 'اورانج كاش 7720', 'انستا باي', 'انستا باي 7720', 'تحويل بنكي',
    CASH_BOX, 'فودافون كاش', 'فودافون كاش 1010', 'فودافون كاش 1079', 'فودافون كاش 2020', 'فودافون كاش 2362',
    'فودافون كاش 2526', 'فودافون كاش 4645', 'فودافون كاش 7711', 'فودافون كاش 7722', 'وي باي 7720',
  ].sort());
});

test('all cash is the Dokki box; a wallet without a number stays its own channel', () => {
  for (const cash of ['كاش', 'نقدي', 'خزنة الدقي', 'خزنة الدقي - كاش', 'cash', ' خزنة  الدقي ']) {
    assert.equal(canonicalChannel(cash), CASH_BOX, cash);
  }
  assert.equal(canonicalChannel('فودافون كاش'), 'فودافون كاش', 'which number it went to is not in the record');
  assert.equal(canonicalChannel('فودافون كاش 01020107711'), 'فودافون كاش 7711');
  assert.equal(canonicalChannel(null), 'غير محدد');
  assert.equal(canonicalChannel('paymob'), 'أونلاين');
});
