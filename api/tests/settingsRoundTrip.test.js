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
  assert.match(helper, /export function parsePaymentMethods/);

  const schema = codeOnly(read('admin/pages/dashboard/tabs/systemSettingsSchema.tsx'));
  assert.match(schema, /'finance\.payment_methods': str/, 'the settings screen writes this key');
  assert.match(schema, /raw\['finance\.payment_methods'\]/, 'and reads the same one back');

  // usePaymentBoxes wraps parsePaymentMethods and adds the boxes with money
  // against them. Both go through this one helper module either way.
  assert.match(helper, /export function usePaymentBoxes/);
  assert.match(helper, /mergePaymentBoxes\(configured, inUse\)/);

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



test('staff can read the institute settings their screens are built from', () => {
  // GET /api/admin/content is requirePermission('manage_content'), and no role
  // holds manage_content — so only a super admin ever loaded it and every staff
  // account ran with content = {}. The production log shows a 403 on it every
  // two minutes while a staff account was open.
  //
  // That is why configured payment methods never reached the booking dialogs:
  // the methods were saved, and the screens never received them.
  const permissions = read('admin/constants/permissions.ts');
  const rolesSection = permissions.slice(permissions.indexOf('ROLE_DEFAULT_PERMISSIONS'));
  assert.ok(!/'manage_content'/.test(rolesSection),
    'if a role gains manage_content this fallback can be revisited');

  const config = read('api/routes/config.js');
  assert.match(config, /router\.get\('\/api\/admin\/content', requireAuth, requireAdminOrStaff, requirePermission\('manage_content'\)/);

  // The public route returns the same object to anonymous callers, so reading it
  // instead exposes nothing that was not already public.
  const publicRoutes = read('api/routes/public.js');
  assert.match(publicRoutes, /router\.get\('\/api\/content', publicLimiter/);

  const api = codeOnly(read('admin/lib/mysqlapi.ts'));
  assert.match(api, /apiFetch<AR>\('\/content'\)/, 'the admin app falls back to it');
});






