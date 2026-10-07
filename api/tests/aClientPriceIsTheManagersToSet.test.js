'use strict';

// «رجع يظهر للمديرين ولحساب هنا فقط انه يدخل سعر مختلف للعميل ,, واظهر زر الخصم
// لو عاوزين نطبقه ,, وخلي خصم النسب يكون في قايمه منسدله» (7 Oct 2026).
// set_client_price is the managers' by default; the owner ticks it for Hana in
// the staff grid. A booking sent with a price of its own (customPrice) is
// taken from them, and refused as a changed price from anyone else.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolvePermissions, hasPermission } = require('../constants/permissions');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the managers may set a client\'s price; sales, collection and support may not', () => {
  for (const role of ['ONLINE_MANAGER', 'DAQQI_MANAGER', 'SALES_COLLECTION_MANAGER', 'TAGAMOA_MANAGER', 'MANAGER']) {
    assert.ok(hasPermission({ role, permissions_json: null }, 'set_client_price'), role);
  }
  for (const role of ['SALES', 'COLLECTION', 'SUPPORT', 'RECEPTION_DAQQI', 'HR']) {
    assert.ok(!resolvePermissions({ role, permissions_json: null }).includes('set_client_price'), role);
  }
  assert.ok(hasPermission({ role: 'SUPPORT', permissions_json: JSON.stringify(['manage_payments', 'set_client_price']) }, 'set_client_price'),
    'and an account it is ticked for, as Hana\'s will be');
});

test('the server takes a booking\'s own price only from someone allowed to set it', () => {
  const route = read('api/routes/subscriber-payments.js');
  assert.match(route, /const clientPrice = payment\.customPrice === true && courseExpected != null\s*\n\s*&& \(req\.isSuperAdmin \|\| hasPermission\(req\.staffRecord, 'set_client_price'\)\);/);
  assert.match(route, /if \(courseExpected != null && !clientPrice && !priceMatches\(courseExpected, tierPrice\.price\)\)/,
    'anyone else still meets «السعر اتغير»');
  assert.match(route, /let resolvedExpected = clientPrice \? courseExpected : tierPrice \? tierPrice\.price : courseExpected;/);
});

test('the booking says it carries its own price only when one was typed', () => {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return; }
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'admin/lib/bookingIdentity.ts')], bundle: true, write: false, format: 'cjs', platform: 'node',
    logLevel: 'silent', nodePaths: [path.join(ROOT, 'admin', 'node_modules')], define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  const { bookingTierFields } = module.exports;
  const base = { priceTier: 'ONLINE_EGYPT', nameAr: 'منى أحمد علي' };
  assert.equal(bookingTierFields({ ...base, customPriceOn: true, customExpected: '2500' }).customPrice, true);
  assert.equal(bookingTierFields({ ...base, customPriceOn: true, customExpected: '' }).customPrice, undefined);
  assert.equal(bookingTierFields({ ...base, customPriceOn: false, customExpected: '2500' }).customPrice, undefined);
});

test('the dialog offers it to whoever holds the permission, and the percentages as a list', () => {
  const modal = read('admin/components/PaymentModal.tsx');
  assert.match(modal, /const canSetPrice = isAdmin \|\| hasPermission\(/);
  assert.match(modal, /'set_client_price'\);/);
  assert.match(modal, /\{canSetPrice && \(<>/);
  assert.match(modal, /<select value=\{tierPct\} aria-label="نسبة الخصم"/);
});
