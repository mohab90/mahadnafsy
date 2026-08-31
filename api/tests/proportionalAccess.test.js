'use strict';
// Proportional access, and the one thing it must never do.
//
// Partial payment used to open a flat two lectures no matter what had been
// paid; it now opens a share of the course. The share moves, and a share that
// can move down is a client losing lectures they were already given — which is
// the complaint ("المحاضرات مقفوله") that the full-access guard beside it was
// written for. The ratio can fall for reasons that have nothing to do with the
// client: a later bookkeeping row against a larger expected total, or a lecture
// published after they paid.
//
// So the arithmetic is checked, and then the direction is checked, because only
// one of those two is a customer-facing promise.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const entitlements = fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'entitlements.js'), 'utf8');

test('the lecture share is computed from published lectures, not a constant', () => {
  assert.match(entitlements, /function proportionalLectureLimit/);
  assert.match(entitlements, /FROM course_lectures[\s\S]{0,80}is_published=1/,
    'unpublished lectures are not part of what was bought');
  assert.match(entitlements, /Math\.ceil\(published \* ratio\)/,
    'rounding up, so any payment opens at least the first lecture');
  assert.match(entitlements, /Math\.min\(published,/,
    'the share can never exceed the course');
});

test('a payment-driven recomputation can raise a limited grant but never lower it', () => {
  // The guard has to be tied to payment-driven sources only: an admin setting a
  // smaller number is a decision, not a recomputation, and must still apply.
  assert.match(entitlements, /paymentDriven && effective\.mode === 'limited' && existing\?\.access_type === 'limited'/);
  assert.match(entitlements, /if \(held > Number\(effective\.lectureLimit \|\| 0\)\) effective = accessPolicy\('limited', held\)/);
  // And the older, coarser half of the same promise is still in place.
  assert.match(entitlements, /existing\?\.access_type === 'full' && policy\.mode === 'limited'/);
});

test('an explicitly named limit beats the arithmetic', () => {
  // Staff granting "three lectures" means three, whatever the ratio says. The
  // ratio is only consulted when nobody named a number.
  assert.match(entitlements, /lectureLimit != null\s*\?\s*lectureLimit\s*:\s*await proportionalLectureLimit/);
});

test('no caller still hands out the flat two lectures', () => {
  const routes = path.join(__dirname, '..', 'routes');
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  }).filter(file => file.endsWith('.js'));

  const flat = [];
  for (const file of walk(routes)) {
    const source = fs.readFileSync(file, 'utf8');
    // The exact shape both callers used: a ternary on 'limited' handing over a
    // hardcoded lecture count.
    if (/=== 'limited' \? \d+ : null/.test(source)) {
      flat.push(path.relative(path.join(__dirname, '..'), file).split(path.sep).join('/'));
    }
  }
  assert.deepEqual(flat, [], 'these still open the same number of lectures however much was paid');
});
