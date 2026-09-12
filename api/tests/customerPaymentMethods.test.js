'use strict';

// The admin's «طرق الدفع اليدوي المتاحة للعميل» setting existed, was saved, and
// reached no customer: /checkout hardcoded four Arabic labels, /my-account
// hardcoded five English codes, and the same channel therefore arrived in
// payment_proofs under two different spellings depending on which screen the
// customer used. These pin the wire down: one source, one vocabulary.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

/** Source with comments removed, so a comment quoting a pattern cannot satisfy a doesNotMatch. */
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map(line => line.replace(/(^|\s)\/\/[^\n]*/, '$1'))
  .join('\n');

test('the public availability endpoint reports which manual channels are configured', () => {
  const route = codeOnly(read('api/routes/public-orders.js'));
  assert.match(route, /function manualMethodsFor\(config\)/);
  assert.match(route, /manualMethods: manualMethodsFor\(config\)/);
  // Both the success answer and the fall-closed answer carry the list: a
  // settings lookup that fails must not leave the only working payment path
  // without a way for the customer to name it.
  assert.match(route, /manualMethods: manualMethodsFor\(null\)/);
});

test('manualMethodsFor keeps known codes, drops junk, and never answers empty', () => {
  // Re-derived from the route text rather than exported, because the route file
  // opens a DB pool on require. The body is short and pinned by the test above.
  const route = read('api/routes/public-orders.js');
  const body = route.slice(route.indexOf('function manualMethodsFor'));
  const end = body.indexOf('\n}\n');
  // eslint-disable-next-line no-new-func
  const manualMethodsFor = new Function(`${body.slice(0, end + 2)}\nreturn manualMethodsFor;`)();

  assert.deepEqual(
    manualMethodsFor({ manual: { supported_methods: ['cash', 'instapay'] } }),
    ['cash', 'instapay']
  );
  // The key DEFAULT_PAYMENT_GATEWAY used to seed still resolves.
  assert.deepEqual(
    manualMethodsFor({ manual: { methods: ['bank_transfer'] } }),
    ['bank_transfer']
  );
  assert.deepEqual(
    manualMethodsFor({ manual: { supported_methods: ['  INSTAPAY ', 'instapay', 'bitcoin', ''] } }),
    ['instapay']
  );
  // Unconfigured means unconfigured, not "this institute refuses transfers".
  assert.ok(manualMethodsFor({ manual: { supported_methods: [] } }).length > 0);
  assert.ok(manualMethodsFor(null).length > 0);
});

test('neither customer screen hardcodes its own payment-method list any more', () => {
  const checkout = codeOnly(read('client/pages/Checkout.tsx'));
  const dashboardTab = codeOnly(read('client/components/student-dashboard/StudentPaymentsTab.tsx'));

  // The exact literal arrays that used to be the source of truth.
  assert.ok(!checkout.includes("['انستا باي', 'فودافون كاش', 'تحويل بنكي', 'اخرى']"),
    'checkout still carries its hardcoded Arabic method list');
  assert.ok(!dashboardTab.includes("{ val: 'instapay', label: 'انستا باي' }"),
    'the dashboard tab still carries its hardcoded code list');

  // Both now read the configured channels through the same hook.
  assert.match(checkout, /useManualPaymentMethods\(\)/);
  assert.match(dashboardTab, /useManualPaymentMethods\(\)/);
  // And render Arabic through the shared label, not by embedding it.
  assert.match(checkout, /paymentMethodLabel\(/);
  assert.match(dashboardTab, /paymentMethodLabel\(/);
});

test('checkout sends a code, and sends the one the customer was looking at', () => {
  const checkout = codeOnly(read('client/pages/Checkout.tsx'));
  // The select falls back to the first configured channel when untouched, so
  // the submitted value has to use the same fallback or the two disagree.
  assert.match(checkout, /value=\{proofMethod \|\| manualMethods\[0\] \|\| ''\}/);
  assert.match(checkout, /payment_method: proofMethod \|\| manualMethods\[0\] \|\| 'other'/);
});

test('the customer dashboard tells the parent which channel is preselected', () => {
  const dashboardTab = codeOnly(read('client/components/student-dashboard/StudentPaymentsTab.tsx'));
  // Without this the picker highlights manualMethods[0] while the parent still
  // holds '', and the server turns '' into 'instapay' — a channel the customer
  // never chose and the institute may not even accept.
  assert.match(dashboardTab, /if \(!proofMethod && manualMethods\.length\) setProofMethod\(manualMethods\[0\]\)/);
});

test('stored methods are labelled everywhere they are shown, in both vocabularies', () => {
  // The module is TypeScript because both browser apps import it; the runtime
  // strips the annotations so the behaviour under test is the shipped code, not
  // a copy of it that could drift.
  const js = require('node:module')
    .stripTypeScriptTypes(read('shared/paymentMethods.ts'))
    .replace(/^export /gm, '');
  const module_ = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', `${js}\nmodule.exports = { normalizePaymentMethod, paymentMethodLabel, sanitizePaymentMethods };`)(module_, module_.exports);
  const { normalizePaymentMethod, paymentMethodLabel, sanitizePaymentMethods } = module_.exports;

  // Both spellings of the same channel land on one label, which is what stops
  // the customer's own «حسب الوسيلة» summary listing it twice.
  assert.equal(paymentMethodLabel('instapay'), 'انستا باي');
  assert.equal(paymentMethodLabel('انستا باي'), 'انستا باي');
  assert.equal(paymentMethodLabel('إنستاباي'), 'انستا باي');
  assert.equal(normalizePaymentMethod('فودافون كاش'), 'vodafone_cash');
  assert.equal(normalizePaymentMethod('تحويل'), 'bank_transfer');

  // The institute's own cash boxes are free text an admin typed. Forcing those
  // into this vocabulary would rename them on screen, so they pass through.
  assert.equal(paymentMethodLabel('خزنة الدقي'), 'خزنة الدقي');
  assert.equal(normalizePaymentMethod('خزنة الدقي'), '');
  assert.equal(paymentMethodLabel(''), '');
  assert.equal(paymentMethodLabel(null), '');

  assert.deepEqual(sanitizePaymentMethods(['cash', 'cash', 'nope']), ['cash']);
  assert.deepEqual(sanitizePaymentMethods('cash'), []);
});

test('the gateway default uses the key the settings screen actually writes', () => {
  const settings = codeOnly(read('api/lib/saasSettings.js'));
  const declared = settings.slice(settings.indexOf('DEFAULT_PAYMENT_GATEWAY'), settings.indexOf('DEFAULT_LEAD_SOURCE_CONNECTORS'));
  assert.match(declared, /supported_methods:/);
  assert.ok(!/\bmethods: \[/.test(declared),
    'the default still seeds manual.methods, which the settings screen never updates');
});

test('the admin screens label a stored method instead of printing the raw code', () => {
  for (const rel of [
    'admin/pages/dashboard/tabs/financial/PaymentProofsPanel.tsx',
    'admin/pages/dashboard/tabs/financial/PaymentReviewPanel.tsx',
  ]) {
    assert.match(codeOnly(read(rel)), /paymentMethodLabel\(/, `${rel} prints the raw stored value`);
  }
});
