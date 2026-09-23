'use strict';

// The half of «فعّل الاسترداد الجزئي» that is not the arithmetic.
//
// applyRefundReversal was taught to give part of the money back, and the route
// was already forwarding the figure — but the screen the desk actually uses
// still said «الاسترداد الجزئي غير مُفعّل» and sent the full amount every time.
// Backend support nobody can reach is not a feature; the desk would have gone
// on refunding in full and reported that nothing had changed.
//
// The dialog had asked for the figure once before and it was taken away on
// purpose: both routes refused anything but the full amount, so every number
// the desk typed came back a 409 after they had filled the form in. That reason
// is gone. This file is here so the two halves cannot drift apart again in
// either direction.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const PANEL = 'admin/pages/dashboard/tabs/financial/FinancialRefundsPanel.tsx';

test('the screen no longer tells the desk the feature is off', () => {
  const panel = read(PANEL);
  assert.ok(!panel.includes('الاسترداد الجزئي غير مُفعّل'),
    'it is enabled now, and the message was the only thing saying otherwise');
  assert.ok(!/refundedAmount = requested;/.test(panel),
    'the amount cannot be hard-coded to the full figure any more');
});

test('it asks for the amount, and starts at the full one', () => {
  const panel = read(PANEL);
  const approve = panel.slice(panel.indexOf("if (status === 'APPROVED')"), panel.indexOf('} else {'));
  assert.match(approve, /promptDialog/, 'the figure is typed, not assumed');
  assert.match(approve, /defaultValue: String\(requested\)/,
    'a full refund stays one Enter away — it is still the common case');
});

test('it refuses more than was asked for, before any request is sent', () => {
  const panel = read(PANEL);
  const approve = panel.slice(panel.indexOf("if (status === 'APPROVED')"), panel.indexOf('} else {'));
  assert.match(approve, /> requested/, 'the ceiling is the amount the customer asked for');
  assert.match(approve, /<= 0|Number\.isFinite/, 'and the floor is a real positive number');
  assert.match(approve, /return;/, 'a bad figure stops here rather than at a 409');
});

test('a partial request can be made in the first place', () => {
  // The part that was easiest to miss. Both routes that create a refund request
  // demanded an amount exactly equal to the payment, so no PENDING request
  // could ever hold a smaller figure — the approval dialog above would have had
  // nothing to approve, and the reversal's partial branch would never have run
  // once. Backend support nobody can reach is not a feature, and it reaches
  // four files.
  const source = read('api/routes/admin-utils.js');
  assert.ok(!source.includes('Partial refunds are not enabled'),
    'neither the customer request nor the admin one may refuse it now');
  assert.equal((source.match(/requestedAmount - Number\(payment\.amount \|\| 0\) > 0\.01/g) || []).length, 2,
    'and both still refuse more than was paid');
});

test('the server still holds the same two limits', () => {
  // The screen checking is a courtesy to the person typing. The route is what
  // actually decides, and it is not allowed to soften.
  const route = read('api/routes/finance.js');
  const guard = route.slice(route.indexOf('let refundedAmount = null;'), route.indexOf('let refundedAmount = null;') + 900);
  assert.match(guard, /refundedAmount <= 0/, 'zero or less is not an approval');
  assert.match(guard, /refundedAmount > requested/, 'nor is more than was requested');
  assert.match(guard, /status\(400\)/, 'and it says so rather than reversing something');
});

test('why the money came back travels with it', () => {
  // The negative payment row carries a note, and the note is where anyone
  // reading the ledger later finds out what this was. Without the decision
  // note it read «استرداد جزئي من دفعة <id>» and stopped there.
  const route = read('api/routes/finance.js');
  const opens = route.indexOf('await applyRefundReversal({');
  const call = route.slice(opens, route.indexOf('}, conn);', opens));
  assert.match(call, /reason:/, 'the reversal is told why');
  assert.match(call, /decisionNote/, 'and what it is told is what the desk typed');
});
