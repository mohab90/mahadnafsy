'use strict';
// Four reports from the leads screens on 27 September:
//   «محلي جديد» and «دولي جديد» said «غير موزّع: 262» above an empty table;
//   a track (مسار) on a lead could not be removed;
//   adding «مسار المعالج» showed other tracks with it;
//   «لما بحدد سعر معين للكورس مش بيتثبت بعد كدا للعميل».
const test = require('node:test');
const assert = require('node:assert/strict');
const { paymentModalSource } = require('./_adminSplitSource');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, read } = require('./support/repo');








test('the payment dialog opens at the price this client agreed', () => {
  const modal = paymentModalSource();
  // The one rule every screen uses (admin/lib/agreedPrice.ts).
  assert.match(modal, /const _agreedPx = heldLine && \(heldLine\.source === 'client' \|\| heldLine\.source === 'booking'\) \? heldLine\.agreed : 0;/); // the server's answer (lib/clientMoney.ts)
  
  assert.match(modal, /const _basePx = _agreedPx > 0 \? _agreedPx : _sysPx;/);
  // A new course booking is priced by its branch tier instead (lib/catalogPricing.ts).
  assert.match(modal, /Math\.round\(_basePx \* \(1 - _discPct \/ 100\)\) : _basePx\)\);/);
});


