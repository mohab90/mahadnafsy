'use strict';

// 31 Oct 2026, found by walking every admin screen and reading the text for «null»: the notification that says a payment has waited for review
// over 24 hours read «null ج.م من …» for every payment, because payments.amount_egp is empty until a payment is approved.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'misc', '_shared.js'), 'utf8');
const sweep = source.slice(source.indexOf('async function runPaymentReviewSweep'), source.indexOf('function schedulePaymentReviewSweep'));

test('the overdue-review alert names the amount it was entered in when there is no pound figure yet', () => {
  assert.match(sweep, /SELECT p\.id, p\.amount, p\.currency, p\.amount_egp,/);
  assert.match(sweep, /const shown = row\.amount_egp != null \? `\$\{Number\(row\.amount_egp\)\} ج\.م` : `\$\{Number\(row\.amount\)\} \$\{row\.currency \|\| 'ج\.م'\}`;/);
  assert.match(sweep, /`\$\{shown\} من «\$\{who\}»/);
  assert.doesNotMatch(sweep, /\$\{row\.amount_egp\}/, 'a figure that is empty until approval is never printed raw');
});
