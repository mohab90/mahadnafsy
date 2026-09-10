'use strict';

// React compares element types by identity. A component declared in the body of
// another is a new function on every render, so React does not reconcile its
// subtree — it unmounts it and mounts a fresh one. Everything inside is
// destroyed and rebuilt: an input loses focus and its caret after every single
// keystroke, a scroll container jumps back to the top, and local state resets.
//
// Four of these were live, and three of them were on screens people type into:
// the ticket-rating note field, the interview-date field on a job applicant,
// and all four edit fields on a WhatsApp channel. Nothing failed loudly — the
// screens simply could not be typed into.
//
// The rule is easy to break again by accident, so it is pinned rather than
// left to review.

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('no component is declared inside another component', () => {
  const scanner = path.join(__dirname, '..', '..', 'tools', 'nested-component-scan.mjs');
  const output = execFileSync(process.execPath, [scanner, '--json'], { encoding: 'utf8' });
  const { scanned, findings } = JSON.parse(output);

  // The denominator matters: a scanner that silently walked nothing would pass.
  assert.ok(scanned > 300, `expected the scan to cover the whole UI, it saw ${scanned} files`);
  assert.deepEqual(
    findings.map(f => `${f.at}  ${f.name}`),
    [],
    'a component declared inside another remounts its subtree on every render'
  );
});
