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

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('a certificate keeps its name across a save', () => {
  const shared = codeOnly(read('admin/pages/dashboard/dashboardShared.tsx'));
  // The name goes into the map with the prices.
  assert.match(shared, /label: t\.label,/);
  assert.ok(!shared.includes('.map(k => ({ key: k, label: k }))'),
    'a custom type used to be rebuilt with its code as its name');
  // And is read back, falling through to the built-in Arabic name and only
  // then to the code.
  assert.match(shared, /DEFAULT_CERT_TYPES\.find\(d => d\.key === key\)\?\.label/);

  const schema = codeOnly(read('admin/pages/dashboard/tabs/systemSettingsSchema.tsx'));
  assert.match(schema, /label: c\.label,/);
});

test('a deleted certificate stays deleted', () => {
  const shared = codeOnly(read('admin/pages/dashboard/dashboardShared.tsx'));
  assert.ok(!shared.includes('return [...DEFAULT_CERT_TYPES, ...extra];'),
    'the defaults were prepended on every read, so a delete could never stick');
  // The saved map is the list; the defaults only seed an empty one.
  assert.match(shared, /if \(!keys\.length\) return DEFAULT_CERT_TYPES;/);

  const schema = codeOnly(read('admin/pages/dashboard/tabs/systemSettingsSchema.tsx'));
  assert.match(schema, /savedCertKeys\.length/);
});

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
  assert.match(helper, /export function parsePaymentMethods/);

  const schema = codeOnly(read('admin/pages/dashboard/tabs/systemSettingsSchema.tsx'));
  assert.match(schema, /'finance\.payment_methods': str/, 'the settings screen writes this key');
  assert.match(schema, /raw\['finance\.payment_methods'\]/, 'and reads the same one back');

  for (const screen of [
    'admin/components/PaymentModal.tsx',
    'admin/pages/dashboard/tabs/daqqi/DaqqiNewClientModals.tsx',
    'admin/pages/dashboard/tabs/daqqi/DaqqiPayModal.tsx',
    'admin/pages/dashboard/tabs/financial/PaymentReviewPanel.tsx',
  ]) {
    const source = codeOnly(read(screen));
    assert.match(source, /parsePaymentMethods\(/, `${screen} must read them through the shared helper`);
    assert.ok(!/DEFAULT_PAYMENT_METHODS\s*=/.test(source),
      `${screen} must not carry its own list`);
  }
});
