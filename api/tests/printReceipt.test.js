'use strict';
// A print stylesheet must not hide the thing it is trying to print.
//
// Both receipts used `body > *:not(#theReceipt) { display: none }`. Neither
// receipt is a child of body — both modals render inside the React tree, under
// div#root — so the rule matched #root, set it to display:none, and took the
// receipt down with it. Every printed receipt was a blank page.
//
// Nothing showed it. The rule only applies to print, so the screen looked
// right; the button said «تسجيل وطباعة» and the payment really was recorded;
// only the paper was empty. Confirmed in the live DOM before fixing:
// document.getElementById('root').matches('body > *:not(#payModalPrintReceipt)')
// is true, and the receipt's parent is not body.
//
// display:none on an ancestor cannot be undone by a descendant. visibility can,
// which is why the replacement survives being nested at any depth.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ADMIN = path.join(__dirname, '..', '..', 'admin');

// Comments are blanked, not removed. Both fixes explain themselves by quoting
// the selector they replaced, so an assertion that the selector is gone fails
// on the explanation of why it went. That is the fifth time in this suite a
// comment has answered an assertion about code; it is cheap to prevent and
// expensive to debug.
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n')
  .map(line => (/^\s*(\/\/|\*)/.test(line) ? '' : line.split('//')[0]))
  .join('\n');
const RECEIPTS = [
  ['components/PaymentModal.tsx', 'payModalPrintReceipt'],
];

test('no print rule hides the receipt by hiding body\'s children', () => {
  for (const [rel, id] of RECEIPTS) {
    const src = codeOnly(fs.readFileSync(path.join(ADMIN, ...rel.split('/')), 'utf8'));
    assert.ok(src.includes(id), `${rel} no longer contains ${id}`);
    assert.doesNotMatch(src, new RegExp(`body > \\*:not\\(#${id}\\)`),
      `${rel} is back to hiding body's children, which hides #root and blanks the printout`);
  }
});

test('each receipt is revealed by visibility, which a descendant can override', () => {
  for (const [rel, id] of RECEIPTS) {
    const src = fs.readFileSync(path.join(ADMIN, ...rel.split('/')), 'utf8');
    assert.match(src, /body \* \{ visibility: hidden !important; \}/,
      `${rel} lost the visibility-based hide`);
    assert.match(src, new RegExp(`#${id}, #${id} \\* \\{ visibility: visible !important; \\}`),
      `${rel} does not make the receipt and its contents visible again`);
    // Taken out of the flow so the hidden page above it does not push it down.
    assert.match(src, new RegExp(`#${id} \\{[\\s\\S]{0,220}position: absolute !important`),
      `${rel} does not position the receipt at the page origin`);
  }
});

test('the scan is reading the receipt', () => {
  // An empty RECEIPTS list would pass every assertion above.
  //
  // There were two: PaymentModal's and the Daqqi desk's own, printed by its own
  // copy of the payment screen. That copy is gone — every booking anywhere
  // opens PaymentModal now, so there is one receipt to check.
  assert.equal(RECEIPTS.length, 1);
  for (const [rel] of RECEIPTS) {
    assert.ok(fs.existsSync(path.join(ADMIN, ...rel.split('/'))), `${rel} is missing`);
  }
});
