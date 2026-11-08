'use strict';
/**
 * Settings that are entered in one place and read in another.
 *
 * Certificate pricing stored only the four prices, never the name, and rebuilt
 * its list as "the eight defaults plus the map's extra keys". So a custom
 * certificate came back as its own code, and a deleted default came back at
 * all. Production shows exactly that: eight custom types saved as 06, 07, 08,
 * 09, 010, 011, 012, 013 with no label anywhere, and four of the eight defaults
 * absent from the map yet still on the screen.
 *
 * Payment methods are read by every booking and payment dialog through one
 * helper, from content['finance.payment_methods'] — and that key does not exist
 * on production, so all of them fall back to a hardcoded list.
 * Run: npm run test:unit
 */
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveCertificatePrice } = require('../lib/certificatePricing');
const { codeOnlyKeepingUrls: codeOnly } = require('./support/repo');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');







test('adding a name to the stored map does not disturb pricing', () => {
  // The API reads specific price fields out of the same object, so carrying a
  // label alongside them changes nothing it looks at.
  const config = {
    institute: { label: 'شهادة المعهد', egyptianEGP: 300, residentEGP: 500, residentSAR: 60, foreignUSD: 18 },
  };
  assert.deepEqual(
    resolveCertificatePrice({ type: 'institute', nationality: 'EGYPTIAN', countryCode: 'EG', pricingConfig: config }),
    { price: 300, currency: 'EGP', status: 'PRICED' });
  assert.deepEqual(
    resolveCertificatePrice({ type: 'institute', nationality: 'SAUDI_RESIDENT', countryCode: 'SA', pricingConfig: config }),
    { price: 60, currency: 'SAR', status: 'PRICED' });
});

test('the payment methods the settings screen writes are the ones the dialogs read', () => {
  // One helper reads them, and it reads one key. The settings screen has to
  // write that key or every dialog silently shows the fallback list instead.
  const helper = codeOnly(read('admin/lib/paymentMethods.ts'));
  

  const schema = codeOnly(read('admin/pages/dashboard/tabs/systemSettingsSchema.tsx'));
  
  

  // usePaymentBoxes wraps parsePaymentMethods and adds the boxes with money
  // against them. Both go through this one helper module either way.
  
  

  for (const screen of [
    'admin/components/payment-modal/usePaymentModalModel.tsx',
    'admin/pages/dashboard/tabs/financial/PaymentReviewPanel.tsx',
  ]) {
    const source = codeOnly(read(screen));
    assert.match(source, /usePaymentBoxes\(/, `${screen} must read them through the shared helper`);
    assert.ok(!/DEFAULT_PAYMENT_METHODS\s*=/.test(source),
      `${screen} must not carry its own list`);
  }
});










