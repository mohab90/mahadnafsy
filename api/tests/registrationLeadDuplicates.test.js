'use strict';
// Converting a registration to a lead must find the lead that already exists.
//
// It used to strip non-digits from the stored phone and compare the result with
// the account's phone exactly as typed. The campaign leads are stored as
// "p:+201006627192"; the account holds "1006627192". Those never met, so the
// same person was written down twice — once by the campaign that found them,
// once by their own signup. Six live pairs, a marketing lead sitting at "new"
// beside a "converted" duplicate.
//
// These tests pin the two halves of the repair: the route delegates to the
// shared matcher, and the matcher covers the spellings that defeated the old
// comparison.
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');
const { findLeadByContact, phoneIdentityClause } = require('../lib/leadMatching');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'routes', 'registrations.js'), 'utf8');

function fakeDb(rows = []) {
  const calls = [];
  return { calls, async query(sql, params) { calls.push({ sql, params }); return [rows]; } };
}

const creator = fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'registrationLead.js'), 'utf8');

test('the route asks the shared matcher instead of comparing phones itself', () => {
  // The route delegates to lib/registrationLead.js now — the routine a signup
  // also goes through, so both reach the same lead — and the matcher call went
  // with it. The rule is unchanged: nobody compares phones by hand.
  assert.match(source, /ensureLeadForUser\(\s*conn\s*,/,
    'converting a registration must go through the shared routine');
  assert.match(creator, /findLeadByContact\(\s*conn\s*,/,
    'the duplicate check must go through findLeadByContact');
  // The specific comparison that failed must not come back.
  assert.doesNotMatch(source, /REGEXP_REPLACE\(phone[^)]*\)\s*=\s*\?/,
    'comparing the stripped column against one unnormalised value is the bug');
  assert.doesNotMatch(source, /LOWER\(TRIM\(email\)\)=LOWER\(TRIM\(\?\)\)/,
    'the email half had the same shape of hole');
});

test('a stored "p:+20…" number matches the account that types the local form', () => {
  // What the campaign rows actually hold, reduced the way the query reduces it.
  const stored = 'p:+201006627192'.replace(/[^0-9]/g, '');
  const clause = phoneIdentityClause('1006627192');
  assert.ok(clause, 'a plausible number must produce a clause');
  assert.ok(clause.params.includes(stored),
    `the spellings must contain ${stored}, got ${clause.params.join()}`);
});

test('every spelling of one Egyptian number reaches the same lead', () => {
  const forms = ['1006627192', '01006627192', '201006627192', '+201006627192', '00201006627192'];
  const canonical = phoneIdentityClause(forms[0]).params.slice().sort();
  for (const form of forms) {
    const clause = phoneIdentityClause(form);
    assert.ok(clause, `${form} must produce a clause`);
    assert.deepEqual(clause.params.slice().sort(), canonical,
      `${form} must resolve to the same spellings as ${forms[0]}`);
  }
});

test('an account with no email does not match a lead that also has none', async () => {
  // The old NULL-guard let one empty address equal another, matching a stranger.
  const db = fakeDb([]);
  await findLeadByContact(db, { tenantId: 't1', phone: '1006627192', email: '' });
  const { sql, params } = db.calls[0];
  assert.ok(!/email\s*=\s*\?/.test(sql) || !params.includes(''),
    'an empty email must not become a matching term');
});

test('a matched lead short-circuits the insert', () => {
  // The insert lives in lib/registrationLead.js with the match in front of it,
  // and the route turns "not created" into the 409 the screen shows.
  const match = creator.indexOf('findLeadByContact');
  const insert = creator.indexOf('INSERT INTO leads');
  assert.ok(match > 0 && insert > 0, 'both the match and the insert must exist');
  assert.ok(match < insert, 'the duplicate guard must come before the insert');
  assert.match(source, /if \(!outcome\.created\)[\s\S]{0,200}res\.status\(409\)/,
    'a person already known must come back as a refusal, not a second row');
});
