'use strict';

// «وسيلة الدفع» in this system is the cash box, not the rail.
//
// The desk records which of the institute's boxes took the money — «خزنة
// الدقي», «فودافون كاش 2020», «اورانج كاش 7720», «احمد السعودية» — and
// الإعدادات ← وسائل الدفع owns that list. Two things followed from it and
// neither was visible from the screen:
//
//   the desk    content['finance.payment_methods'] has never been saved on
//               this tenant, so every payment dialog fell back to a list
//               written into the source: seven names, one of which has never
//               taken a pound, and none of the ten boxes holding 124,000 EGP
//               between them. The dropdown is closed, so those boxes simply
//               could not be chosen any more.
//
//   the student the customer's own payments page printed the box verbatim.
//               Someone who paid into «احمد السعودية» read that back as their
//               payment method; someone who paid into «فودافون كاش 2020» read
//               the institute's wallet number.
//
// So there are two labels now, and the difference is who is looking:
// paymentMethodLabel keeps the box whole for the desk, and
// customerPaymentMethodLabel answers only the rail behind it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SHARED = path.join(ROOT, 'shared', 'paymentMethods.ts');
const source = () => fs.readFileSync(SHARED, 'utf8');

// The real module, not a copy of it. node strips the type annotations, so what
// runs below is the code both browsers ship — a ported reimplementation drifts
// the moment a branch changes, and three mutations of this file's own rules
// slipped past exactly that way on the first attempt.
function build() {
  const js = require('node:module')
    .stripTypeScriptTypes(fs.readFileSync(SHARED, 'utf8'))
    .replace(/^export /gm, '');
  const box = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports',
    js + '\nmodule.exports = { LABELS, ALIASES, normalizePaymentMethod, paymentMethodLabel, customerPaymentMethodLabel };',
  )(box, box.exports);
  const m = box.exports;
  return {
    LABELS: m.LABELS,
    ALIASES: m.ALIASES,
    normalize: m.normalizePaymentMethod,
    deskLabel: m.paymentMethodLabel,
    customerLabel: m.customerPaymentMethodLabel,
  };
}

// Every distinct value in production's payments.payment_method, read off the
// live table. Kept verbatim because the point of this test is that the rule
// answers for the data that exists, not for the data it was designed against.
const PRODUCTION_BOXES = [
  'فودافون كاش', 'احمد السعودية', 'تحويل بنكي', 'فودافون كاش 2020',
  'فودافون كاش 7722', 'فودافون كاش 1079', 'انستا باي', 'أخرى',
  'فودافون كاش 2362', 'اورانج كاش 7720', 'خزنة الدقي', 'فودافون كاش 7711',
  'وي باي 7720', 'فودافون كاش 4645', 'فودافون كاش 2526', 'cash', 'كاش',
  'qa_smoke', 'online_paymob',
];

// The behaviour is exercised for real above, so these are not a substitute for
// it — they name what each branch is *for*, so that deleting one fails with the
// reason rather than with a table of Arabic strings.
//
// Plain includes, not regexes: these lines are mostly metacharacters, a
// template literal eats the backslash out of \s, and a pattern that matches
// nothing is a guard that passes forever.
const PINS = [
  [`  if (HAS_ARABIC.test(value)) return value;`,
    'a box the desk typed is Arabic and is never looked up — «كاش» is a box, not the code cash'],
  [`  return (code && LABELS[code]) || LABELS[value.toLowerCase()] || value;`,
    'the desk falls through to the box name — that is what keeps «فودافون كاش 2020» whole'],
  [`    if (prefix.length >= 4 && lower.startsWith(prefix)) return LABELS[code] || '';`,
    'the customer label strips the account tail by matching the rail as a prefix'],
  [`  if (lower.startsWith('خزنة')) return LABELS.cash;`,
    'a desk till is cash'],
  [`  return '';
}

/** Keeps only codes this build knows, in the order the settings list them. */`,
    'and anything else is nothing — never the box name, which may be a person'],
];

test('the two labels still differ in the way that matters', () => {
  const text = source();
  for (const [line, why] of PINS) {
    assert.ok(text.includes(line), `${why} — shared/paymentMethods.ts no longer has: ${line.trim().slice(0, 70)}`);
  }
});

test('the desk keeps the whole box name', () => {
  const { deskLabel } = build();
  // Which wallet took the money is the whole reason the desk writes it down.
  for (const box of ['فودافون كاش 2020', 'اورانج كاش 7720', 'خزنة الدقي', 'احمد السعودية', 'وي باي 7720', 'كاش']) {
    assert.equal(deskLabel(box), box, `${box} is a box and must not be renamed on the desk's screens`);
  }
});

test('the customer is told the rail, never the box', () => {
  const { customerLabel } = build();

  assert.equal(customerLabel('فودافون كاش 2020'), 'فودافون كاش', 'the account tail is the institute\'s');
  assert.equal(customerLabel('فودافون كاش 7711'), 'فودافون كاش');
  assert.equal(customerLabel('احمد السعودية'), '', 'a person\'s name must never reach the customer');
  // Two wallets the institute collects into that were not in the vocabulary at
  // all, so the nine payments made to them could only be shown to the people
  // who made them as «غير محدد».
  assert.equal(customerLabel('اورانج كاش 7720'), 'اورانج كاش');
  assert.equal(customerLabel('وي باي 7720'), 'وي باي');
  assert.equal(customerLabel('خزنة الدقي'), 'نقدي', 'they walked in and paid — say so');
  assert.equal(customerLabel('تحويل بنكي'), 'تحويل بنكي');
  assert.equal(customerLabel('انستا باي'), 'انستا باي');
  assert.equal(customerLabel('cash'), 'نقدي');
  assert.equal(customerLabel('كاش'), 'نقدي');
  assert.equal(customerLabel('online_paymob'), 'دفع إلكتروني');
  assert.equal(customerLabel('qa_smoke'), '', 'not a rail, so nothing');

  // The invariant, over every value the table actually holds: whatever comes
  // back is either empty or one of the labels — never a stored box name.
  const { LABELS } = build();
  const allowed = new Set(Object.values(LABELS));
  for (const box of PRODUCTION_BOXES) {
    const shown = customerLabel(box);
    if (shown === '') continue;
    assert.ok(allowed.has(shown), `«${box}» showed «${shown}», which is not one of the rail labels`);
    if (!allowed.has(box)) {
      assert.notEqual(shown, box, `«${box}» reached the customer verbatim`);
    }
  }
});

test('the student\'s own screens ask the customer question', () => {
  const rel = 'client/components/student-dashboard/StudentPaymentsTab.tsx';
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');

  // The payment history is boxes; the proof is what the customer said they used.
  assert.ok(!/paymentMethodLabel\(payment\.paymentMethod\)/.test(text),
    'a payment row carries the institute\'s box, so it needs customerPaymentMethodLabel');
  assert.match(text, /customerPaymentMethodLabel\(payment\.paymentMethod\)/);
  assert.match(text, /paymentMethodLabel\(proof\.payment_method\)/,
    'a proof carries what the customer themself picked, which is already a rail');
});

test('the dialog offers the boxes that have money in them', () => {
  // The settings key is unsaved on this tenant, so a hardcoded fallback was the
  // entire offer. The route below is the second half of the list.
  const route = fs.readFileSync(path.join(ROOT, 'api', 'routes', 'subscriber-payments.js'), 'utf8');
  assert.match(route, /router\.get\('\/api\/admin\/payment-boxes'/);
  assert.match(route, /requirePermission\('manage_payments'\)/);

  // Same permission as recording a payment. 'view_financial' would empty the
  // dropdown for the reception and sales staff who actually use it.
  const guard = /router\.get\('\/api\/admin\/payment-boxes'[^\n]*/.exec(route)[0];
  assert.ok(!guard.includes('view_financial'), 'that gate hides the list from the desk');
  assert.match(route, /GROUP BY payment_method\s*\n\s*ORDER BY egp DESC/);
  assert.match(route, /status = 'paid'/, 'an unconfirmed payment is not evidence a box is in use');

  const lib = fs.readFileSync(path.join(ROOT, 'admin', 'lib', 'paymentMethods.ts'), 'utf8');
  assert.match(lib, /export function mergePaymentBoxes/);
  assert.match(lib, /export function usePaymentBoxes/);

  // Ported: configured first, then anything used that is not already there.
  const merge = (configured, inUse) => {
    const seen = new Set(configured.map(b => b.trim()).filter(Boolean));
    const out = [...seen];
    for (const box of inUse) {
      const name = String(box || '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
    return out;
  };
  const configured = ['خزنة الدقي', 'خزنة الفرع', 'فودافون كاش', 'انستا باي', 'تحويل بنكي', 'كاش', 'أخرى'];
  const merged = merge(configured, PRODUCTION_BOXES);
  for (const box of PRODUCTION_BOXES) {
    assert.ok(merged.includes(box), `«${box}» has money against it and must be selectable`);
  }
  assert.ok(merged.includes('خزنة الفرع'), 'a configured box with no history is still the admin\'s intent');
  assert.equal(new Set(merged).size, merged.length, 'no box listed twice');
  assert.deepEqual(merged.slice(0, configured.length), configured, 'the admin\'s list comes first');
});

test('one request per session, not one per dialog', () => {
  const lib = fs.readFileSync(path.join(ROOT, 'admin', 'lib', 'paymentMethods.ts'), 'utf8');
  // The dialog opens from eleven places; a fetch on every open is eleven times
  // the traffic for a list that changes when an admin edits a setting.
  assert.match(lib, /let boxesInUse: string\[\] \| null = null;/);
  assert.match(lib, /if \(boxesInUse\) return boxesInUse;/);
  assert.match(lib, /if \(!boxesPending\)/, 'two dialogs opening at once must share one request');
  assert.match(lib, /\.catch\(\(\) => \[\]\)/, 'a failure leaves the configured list rather than an empty dropdown');
});
