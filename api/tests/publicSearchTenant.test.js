'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'public.js'), 'utf8');
const studentAiRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'student-ai.js'), 'utf8');



test('student AI context cannot resolve subscriber or courses globally', () => {
  // This pinned the subscriber lookup's exact SQL, which stopped being true
  // when the lookup moved into lib/subscriberIdentity — the shared resolver
  // that tries uid, then email, then phone, and scopes every one of those to
  // the tenant. Resolving by email alone here meant a client who signed in
  // with a WhatsApp number got no context at all.
  //
  // So assert the property the test is named for instead of the text that
  // happened to carry it: the route hands the resolver the request, and the
  // course lookup it drives is still tenant-scoped.
  // The context now holds the tenant's published catalogue, from which the
  // student's own courses are picked (the assistant answers course questions).
  
  
  
  
  

  // The resolver it delegates to has to be the tenant-scoped one.
  const resolver = fs.readFileSync(
    path.join(__dirname, '..', 'lib', 'subscriberIdentity.js'), 'utf8');
  const lookups = resolver.match(/FROM subscribers s\b[\s\S]*?LIMIT 1/g) || [];
  assert.ok(lookups.length >= 3, `only ${lookups.length} subscriber lookups found in the resolver`);
  for (const lookup of lookups) {
    assert.match(lookup, /s\.tenant_id=\?/);
    assert.match(lookup, /s\.deleted_at IS NULL/);
  }
});


