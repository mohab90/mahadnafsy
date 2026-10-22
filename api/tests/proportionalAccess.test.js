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

// The share itself — computed from published lectures, rounded up, never lowered
// by a recomputation, beaten by a named number — is exercised against the
// database in tests/integration/learningAccess.integration.test.js. This scan
// keeps the routes from handing out a flat count again.

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
