'use strict';

// One vocabulary for «وسيلة الدفع», on both sides of the screen.
//
// shared/paymentMethods.ts was written to end exactly this split — its own
// header says there were three lists and none of them was the setting an admin
// edits. The customer screens moved onto it. The admin screens did not, and
// kept four more:
//
//   dashboardHelpers.translatePayMethod   ten entries, called by nothing
//   OrdersTab.payMethodBadge              eight entries, no 'bank_transfer'
//   PaymentSettingsTab.METHOD_LABEL_AR    four entries, rendered by nothing
//   SystemSettingsTab.CHANNEL_LABEL_AR    four entries, live
//
// The one that showed: 'bank_transfer' is one of the four rails the manual
// payment flow writes, and the orders screen had no entry for it — a customer
// who paid by transfer appeared under the bare token, in the grey «unknown»
// badge, next to rows that read «تحويل بنكي» because they were saved with the
// older spelling.
//
// The rule: an Arabic payment-method label is written in one file.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SHARED = 'shared/paymentMethods.ts';

const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map(line => line.replace(/(^|\s)\/\/[^\n]*/, '$1'))
  .join('\n');

function browserSources() {
  const out = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  for (const app of ['admin', 'client', 'shared']) walk(path.join(ROOT, app));
  return out.map(f => path.relative(ROOT, f).split(path.sep).join('/'));
}

const read = rel => codeOnly(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

// Two things in this system are called «وسيلة الدفع» and only one of them is
// a rail:
//
//   the rail       how the money moved — cash, instapay, bank_transfer,
//                  vodafone_cash. A fixed vocabulary, shown to the customer,
//                  and the thing this test is about.
//
//   the cash box   which of the institute's boxes or people received it —
//                  «خزنة الدقي», «خزنة الفرع», «احمد السعودية». Free text an
//                  admin types in الإعدادات، owned by admin/lib/paymentMethods,
//                  and deliberately not translated: renaming a box on screen
//                  would be wrong.
//
// So the offence is not "this file contains Arabic that names a rail" —
// Checkout's «راسلنا واتساب» instruction line does that and is prose. The
// offence is pairing a rail *code* with an Arabic name, which is a label map,
// and there may be only one of those.
const RAIL_LABELS = ['فودافون كاش', 'انستا باي', 'إنستاباي', 'تحويل بنكي'];
const RAIL_CODES = ['vodafone_cash', 'instapay', 'bank_transfer', 'cash', 'vodafone', 'bank'];

function labelMapLines(source) {
  return source.split('\n').filter(line =>
    RAIL_LABELS.some(label => line.includes(label)) &&
    RAIL_CODES.some(code => new RegExp(`['"\`]${code}['"\`]|\\b${code}\\s*:`).test(line)));
}

test('only one file pairs a rail code with an Arabic name', () => {
  const files = browserSources();
  assert.ok(files.length > 300, `expected both app trees, saw ${files.length}`);

  const offenders = [];
  for (const rel of files) {
    if (rel === SHARED) continue;
    const hits = labelMapLines(read(rel));
    if (hits.length) offenders.push(`${rel} (${hits.length} line(s))`);
  }
  assert.deepEqual(offenders, [],
    'these carry their own payment-method wording: ' + offenders.join(', '));

  // The premise, twice over. The shared module is what they reach for now —
  assert.ok(labelMapLines(read(SHARED)).length >= 3, 'the shared module should hold the label map');
  const adopters = files.filter(rel => /from '[^']*shared\/paymentMethods'/.test(read(rel)));
  assert.ok(adopters.length >= 8, `expected the migrated screens, saw ${adopters.length}`);

  // — and the cash boxes are still their own list, untranslated, in the module
  // that owns them. Collapsing the two concepts is the other way to break this.
  const boxes = read('admin/lib/paymentMethods.ts');
  assert.match(boxes, /export const DEFAULT_PAYMENT_METHODS = \[/);
  assert.ok(boxes.includes('خزنة الدقي'), 'the institute\'s own boxes are free text and stay so');
  assert.equal(labelMapLines(boxes).length, 0, 'the box list must not acquire codes');
});

test('the four rails are listed once', () => {
  const files = browserSources();
  // The literal array, in any spacing. Only the shared module declares it.
  const offenders = files.filter(rel => {
    if (rel === SHARED) return false;
    const source = read(rel).replace(/\s+/g, ' ');
    return source.includes(`'cash', 'instapay', 'bank_transfer', 'vodafone_cash'`);
  });
  assert.deepEqual(offenders, [],
    'these re-declare the rail list instead of importing PAYMENT_METHOD_CODES: ' + offenders.join(', '));

  const shared = read(SHARED);
  assert.match(shared, /export const PAYMENT_METHOD_CODES = \['cash', 'instapay', 'bank_transfer', 'vodafone_cash'\] as const;/);
});

test('every rail the manual flow writes has a label', () => {
  // The gap that showed on the orders screen. Run it, do not read it.
  const source = fs.readFileSync(path.join(ROOT, SHARED), 'utf8');

  const codes = /PAYMENT_METHOD_CODES = \[([^\]]*)\]/.exec(source)[1]
    .split(',').map(part => part.trim().replace(/^'|'$/g, '')).filter(Boolean);
  assert.deepEqual(codes, ['cash', 'instapay', 'bank_transfer', 'vodafone_cash']);

  const labelBlock = /const LABELS: Record<string, string> = \{([\s\S]*?)\n\};/.exec(source)[1];
  for (const code of codes) {
    assert.match(labelBlock, new RegExp(`(^|\\n)\\s*${code}:`),
      `${code} is a rail the manual payment flow writes and has no label — it would render as the raw token`);
  }
});

test('a value saved under an older spelling still reads back as the same rail', () => {
  // Historic rows are not rewritten; two vocabularies have to keep resolving.
  const source = fs.readFileSync(path.join(ROOT, SHARED), 'utf8');
  for (const [stored, expected] of [
    ['تحويل بنكي', 'bank_transfer'],
    ['انستا باي', 'instapay'],
    ['فودافون كاش', 'vodafone_cash'],
    ['banktransfer', 'bank_transfer'],
    ['bank-transfer', 'bank_transfer'],
  ]) {
    assert.match(source, new RegExp(`'?${stored}'?: '${expected}'`),
      `${stored} was written by a screen this system shipped and must still resolve`);
  }

  // And an institute cash box stays its own name — «خزنة الدقي» is free text
  // an admin typed, and renaming it on screen would be wrong.
  assert.match(source, /return ALIASES\[value\] \|\| ALIASES\[lower\] \|\| '';/);
  assert.match(source, /return \(code && LABELS\[code\]\) \|\| LABELS\[value\.toLowerCase\(\)\] \|\| value;/);
});

test('what production actually stores resolves to the rail the filter offers', () => {
  // The bug the first attempt at this fix did not close. orders.payment_method
  // holds 'TRANSFER' upper-cased for most rows, and 'transfer' used to be its
  // own key in LABELS — so normalizePaymentMethod short-circuited there and
  // returned 'transfer', which never equals the filter's 'bank_transfer'.
  // Caught by running the built bundle against the real values, not by reading
  // the source. 'transfer' is an alias now, not a rail.
  const source = fs.readFileSync(path.join(ROOT, SHARED), 'utf8');

  const labelBlock = /const LABELS: Record<string, string> = \{([\s\S]*?)\n\};/.exec(source)[1];
  const aliasBlock = /const ALIASES: Record<string, string> = \{([\s\S]*?)\n\};/.exec(source)[1];

  assert.ok(!/^\s*transfer:/m.test(labelBlock),
    "'transfer' as a LABELS key makes normalizePaymentMethod stop there; it is a spelling of bank_transfer");
  assert.match(aliasBlock, /^\s*transfer: 'bank_transfer',/m);

  // Every value production holds today, and where it has to land.
  for (const [stored, code] of [
    ['transfer', 'bank_transfer'],
    ['paymob', 'online_paymob'],
    ['bank', 'bank_transfer'],
    ['vodafone', 'vodafone_cash'],
  ]) {
    // Plain includes: a template literal eats the backslash out of \s, and a
    // pattern that matches nothing is a guard that passes forever.
    assert.ok(aliasBlock.includes(`\n  ${stored}: '${code}',`),
      `${stored} is in the orders or refunds table and must resolve to ${code}`);
  }

  // 'manual' is not a rail but orders carry it, and the filter shows its label.
  assert.match(labelBlock, /^\s*manual: 'يدوي',/m,
    "without a label the filter's own option would read 'manual' in English");

  // The comparison itself: both sides normalized, and a raw lowercase fallback
  // so an unrecognised value still filters to itself rather than to everything.
  const derived = read('admin/pages/dashboard/hooks/useOrdersDerived.ts');
  assert.ok(!/row\.paymentMethod === orderMethodFilter/.test(derived),
    'a plain === here is what made «تحويل بنكي» return nothing');
  assert.match(derived, /sameMethod\(row\.paymentMethod, orderMethodFilter\)/);
  assert.match(derived, /normalizePaymentMethod\(a\) \|\| String\(a \|\| ''\)\.trim\(\)\.toLowerCase\(\)/);
});
