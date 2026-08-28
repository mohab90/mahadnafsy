'use strict';

// Facebook Lead Ads exports a phone as "p:+201227155562". Older sheets held the
// same number as "1227155562". Both importers compared the text, so the August
// re-import created a second lead for people already in the CRM: 11,158 of them,
// 41% of every lead that has a phone. Liza gamal was in there twice, once under
// each spelling.
//
// toIdentity was already in lib/phoneNumber.js for exactly this. These pin the
// rule that the importers compare and store identities, not spellings.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { toIdentity } = require('../lib/phoneNumber');

test('every spelling of one Egyptian number reduces to the same identity', () => {
  const spellings = [
    'p:+201227155562',   // Facebook Lead Ads
    '+201227155562',
    '00201227155562',
    '201227155562',
    '01227155562',
    '1227155562',
    'p:01227155562',
    '01227155562 ',
    '012-2715-5562',
  ];
  const identities = new Set(spellings.map(toIdentity));
  assert.strictEqual(identities.size, 1,
    'expected one identity, got: ' + [...identities].join(', '));
  assert.strictEqual([...identities][0], '1227155562');
});

test('the old text comparison treated those spellings as different people', () => {
  // What the importers used to do.
  const oldNormalise = (value) => String(value).replace(/[\s-]/g, '');
  const spellings = ['p:+201227155562', '1227155562', 'p:01227155562'];
  const seen = new Set(spellings.map(oldNormalise));
  assert.strictEqual(seen.size, 3, 'the old rule really did see three distinct values');
});

test('a foreign number keeps its country code', () => {
  // Only the local trunk prefix and Egypt's own code are stripped; a Saudi
  // number must not be shortened into something that could collide.
  assert.strictEqual(toIdentity('+9711555299065'), '9711555299065');
  assert.notStrictEqual(toIdentity('+9711555299065'), toIdentity('01555299065'));
});

test('unusable input yields an empty identity rather than a wrong one', () => {
  for (const value of [null, undefined, '', '   ', 'p:', 'abc', '+']) {
    assert.strictEqual(toIdentity(value), '');
  }
});

test('both importers compare and store the identity', () => {
  const stripComments = (text) => text
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n');

  const sheets = stripComments(
    fs.readFileSync(path.join(__dirname, '..', 'lib', 'sheets.js'), 'utf8'));
  assert.ok(sheets.includes("toIdentity"), 'lib/sheets.js should use toIdentity');
  assert.ok(!/phone\.replace\(\/\[\\s-\]\/g\s*,\s*''\)/.test(sheets),
    'lib/sheets.js must not dedup on a text-stripped phone');

  const gsheets = stripComments(
    fs.readFileSync(path.join(__dirname, '..', 'routes', 'gsheets.js'), 'utf8'));
  assert.ok(gsheets.includes('toIdentity'), 'routes/gsheets.js should use toIdentity');
  assert.ok(!/AND phone=\?[^\n]*\[req\.tenantId, phone\]/.test(gsheets),
    'routes/gsheets.js must not look up an existing lead by the raw phone');
});
