'use strict';

// Deleting a customer archives them and deactivates their login, and login is
// what checks is_active — so the lecture query never asked whether the customer
// still existed. 38 archived customers were found still carrying an active
// enrolment, and 8 of them still had an active user row: all test accounts, but
// the only thing between them and the lectures was the login gate.
//
// This pins the second gate. It is a source check rather than a live query
// because the module talks to the database on every call, and what matters is
// that the condition is in the statement at all.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'learningAccess.js'), 'utf8');

test('the lecture query requires the customer to still exist', () => {
  assert.match(source, /s\.deleted_at IS NULL/,
    'an archived customer must not resolve to an accessible lecture');
});

test('the existence check is tied to the enrolment, not left dangling', () => {
  // Scoped to the enrolment's own subscriber and tenant — a check against some
  // other row would pass for the wrong reason.
  assert.match(source, /s\.id=e\.subscriber_id/);
  assert.match(source, /s\.tenant_id=e\.tenant_id/);
});

test('the enrolment conditions that were already there are still there', () => {
  // The guard is added to the join, so the original conditions have to survive
  // it: a rewrite that dropped one would open access rather than close it.
  assert.match(source, /e\.course_id=cl\.course_id/);
  assert.match(source, /e\.subscriber_id=\?/);
  assert.match(source, /e\.status='active'/);
  assert.match(source, /c\.deleted_at IS NULL/, 'a deleted course stays inaccessible too');
  assert.match(source, /cl\.is_published=1/);
});

test('expiry, lecture limit and drip are all still enforced', () => {
  // Everything the function refuses on. If one of these disappears the module
  // still returns accessible:true for the case it was meant to stop.
  for (const reason of ['not_found', 'not_enrolled', 'access_expired', 'access_limited', 'drip_locked']) {
    assert.ok(source.includes(`'${reason}'`), `${reason} should still be a refusal`);
  }
});
