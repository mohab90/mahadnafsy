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
  assert.match(archiveBlock, /UPDATE users SET is_active=0/);
  assert.match(archiveBlock, /sub\.firebase_uid \? 'id=\?' : null/);
  // Guarded, so an absent email cannot become `LOWER(TRIM(email))=''`.
  assert.match(archiveBlock, /normEmail \? "LOWER\(TRIM\(email\)\)=\?" : null/);
});

test('restoring gives back exactly what archiving took', () => {
  assert.ok(restoreBlock.length > 200, 'the restore handler was not located');
  assert.match(restoreBlock, /SELECT id, name, email, firebase_uid FROM subscribers/);
  assert.match(restoreBlock, /UPDATE users SET is_active=1/);
  assert.match(restoreBlock, /sub\.firebase_uid \? 'id=\?' : null/);
  assert.match(restoreBlock, /normEmail \? "LOWER\(TRIM\(email\)\)=\?" : null/);
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
