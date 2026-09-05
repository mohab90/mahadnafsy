'use strict';
// "Has this person already been triaged?" must get one answer.
//
// The registrations queue asked it with `leads.hidden=0`, so anyone whose lead
// had been archived came back to the top of the list as a brand new signup:
// 202 rows where 94 needed action. The other 108 were dismissed work
// reappearing, and converting one would have created a second lead for
// somebody a colleague had deliberately archived.
//
// lib/reconcileChecks.js had already answered it the other way, and says so in
// its own comment: comparing only against hidden=0 leads made its count 173
// when the truth was 53. An archived lead is still a CRM projection — the
// person is known, just not in the active queue.
//
// So the rule is: within registrations.js, no query may narrow `leads` to
// hidden=0 when deciding whether an account is claimed. The listing, and the
// guard that refuses to delete a claimed account, have to agree.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n')
  .map(line => (/^\s*(\/\/|\*)/.test(line) ? '' : line.split('//')[0]))
  .join('\n');

const read = rel => codeOnly(fs.readFileSync(path.join(__dirname, '..', ...rel.split('/')), 'utf8'));
const registrations = read('routes/registrations.js');
const reconcile = read('lib/reconcileChecks.js');

test('the registrations queue does not treat an archived lead as unknown', () => {
  // Comments are stripped first: this file's explanation of the fix names the
  // very comparison it forbids, and so does the route's.
  assert.doesNotMatch(registrations, /FROM leads[\s\S]{0,80}hidden\s*=\s*0/,
    'a leads lookup here is narrowed to hidden=0 — archived leads would be re-queued as new signups');
  assert.doesNotMatch(registrations, /hidden\s*=\s*0/,
    'no hidden=0 comparison belongs in registration triage');
});

test('the listing and the delete guard ask the same question', () => {
  const listing = registrations.slice(
    registrations.indexOf("router.get('/api/admin/registrations'"),
    registrations.indexOf("router.post('/api/admin/registrations/:userId/convert-online'"));
  const remove = registrations.slice(registrations.indexOf("router.delete('/api/admin/registrations/:userId'"));

  assert.ok(listing.length > 200 && remove.length > 200, 'a handler was not located');
  for (const [name, block] of [['listing', listing], ['delete guard', remove]]) {
    assert.match(block, /FROM leads/, `${name} no longer consults leads at all`);
    assert.doesNotMatch(block, /hidden/, `${name} still filters leads by hidden`);
  }
});

test('the reconcile check this borrows its definition from still holds it', () => {
  // If reconcileChecks ever goes back to hidden=0, the two drift apart again
  // and this file's premise is gone — so it is asserted here rather than
  // assumed.
  // Scoped to this check's own sql, not a fixed number of characters after its
  // name — a window that long runs into the next check in the array, whose
  // hidden=0 is legitimate and is what failed this assertion first time.
  // Anchored on the key, not the display name: the name changed once already
  // when the check went from critical to a queue depth, and that broke this.
  const start = reconcile.indexOf("key: 'orphan_customer_users'");
  assert.ok(start > 0, 'the unlinked-users check was not located');
  const sqlStart = reconcile.indexOf('sql:', start);
  const sqlEnd = reconcile.indexOf('`,', sqlStart);
  const sql = reconcile.slice(sqlStart, sqlEnd);
  assert.ok(sql.includes('FROM leads'), 'the check no longer consults leads');
  assert.doesNotMatch(sql, /hidden/,
    'the reconcile check narrowed itself back to live leads');
});
