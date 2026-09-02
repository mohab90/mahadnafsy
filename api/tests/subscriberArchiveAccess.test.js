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

const archiveBlock = catalog.slice(
  catalog.indexOf("router.delete('/api/admin/subscribers/:id'"),
  catalog.indexOf("router.get('/api/admin/subscribers/archived")) || catalog.length;
const restoreBlock = catalog.slice(
  catalog.indexOf("router.post('/api/admin/subscribers/:id/restore'"),
  catalog.indexOf("router.delete('/api/admin/lectures/:id'"));

test('archiving a customer disables the sign-in account by uid, not only by email', () => {
  assert.ok(archiveBlock.length > 200, 'the archive handler was not located');
  assert.match(archiveBlock, /SELECT id, email, phone, firebase_uid FROM subscribers/);
  assert.match(archiveBlock, /UPDATE users u SET u\.is_active=0/);
  assert.match(archiveBlock, /customerAccountMatch\(sub\)/);
});

test('restoring gives back exactly what archiving took', () => {
  assert.ok(restoreBlock.length > 200, 'the restore handler was not located');
  assert.match(restoreBlock, /SELECT id, name, email, firebase_uid FROM subscribers/);
  assert.match(restoreBlock, /UPDATE users u SET u\.is_active=1/);
  // The same predicate, not a second copy of it: the two drifted apart once
  // already, and a restore that matches less than the archive leaves the
  // customer active in the list and unable to sign in.
  assert.match(restoreBlock, /customerAccountMatch\(sub\)/);
});

test('the account predicate covers every customer role and excludes staff', () => {
  // role='user' alone missed the 17 customer accounts stored as role='client'
  // — archiving one of those left their sign-in live.
  assert.match(catalog, /const CUSTOMER_ROLES = \['user', 'client', 'student'\]/);

  // And it must never reach a colleague: 4 accounts linked to a subscriber
  // record are staff, and archiving someone's customer record must not take
  // away their staff sign-in.
  assert.match(catalog, /NOT EXISTS \(\s*SELECT 1 FROM staff st/);
  assert.match(catalog, /st\.firebase_uid=u\.id OR LOWER\(TRIM\(st\.email\)\)=LOWER\(TRIM\(u\.email\)\)/);

  // An absent email must drop its arm rather than become `=''`, which matches
  // every account with a blank email instead of none.
  assert.match(catalog, /if \(email\) \{ arms\.push\('LOWER\(TRIM\(u\.email\)\)=\?'\)/);
  assert.match(catalog, /if \(!arms\.length\) return null;/);
});

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
