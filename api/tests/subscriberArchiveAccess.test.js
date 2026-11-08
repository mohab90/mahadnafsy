'use strict';
// Archiving a customer has to actually take their access away, and restoring
// has to give back exactly what archiving took.
//
// The archive matched the sign-in account by email alone. A customer who
// signed up with a WhatsApp number has no email, so the UPDATE matched nothing
// and their account stayed active — archived in the admin list, still able to
// sign in. Restore had the same shape, so the mirror fault was there too: such
// a customer would come back to the list still unable to sign in.
//
// Course access is deliberately left in place by both — "delete" here is an
// archive, and enrolments are what a restore restores. It is safe only because
// lib/subscriberIdentity refuses to resolve a deleted subscriber at all, which
// is asserted below: if that ever stops being true, 10 archived customers
// holding 34 live enrolments become reachable again.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', ...rel.split('/')), 'utf8');
const catalog = read('routes/core/catalog.js');
const identity = read('lib/subscriberIdentity.js');

// Archiving signs the login out (found by its id), restoring gives it back, a
// member of staff is never caught: over HTTP in
// tests/integration/learningAccess.integration.test.js. The resolver scan below
// stays: it covers every lookup at once.



test('an archived customer cannot be resolved as the signed-in client', () => {
  // Every arm of the resolver, not just the first: the uid arm was always
  // guarded, and the email and phone arms are the ones that would let an
  // archived customer back in.
  const lookups = identity.match(/FROM subscribers s\b[\s\S]*?LIMIT 1/g) || [];
  assert.ok(lookups.length >= 3,
    `only ${lookups.length} subscriber lookups found in the resolver — it is not being read`);
  for (const lookup of lookups) {
    assert.match(lookup, /s\.deleted_at IS NULL/);
    assert.match(lookup, /s\.tenant_id=\?/);
  }
});
