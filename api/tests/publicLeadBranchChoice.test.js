'use strict';

// Every public form on the site asks «اختر الفرع الأقرب إليك» and offers the
// physical branches by name. POST /api/registrations — the route all of them
// call — destructured that answer into an unused variable and filed the lead
// under a branch derived from the visitor's IP instead.
//
// branchForCountry only ever answers ONLINE_EGYPT, ONLINE_SAUDI or
// ONLINE_ABROAD, so it can never name a physical branch: a visitor asking for
// Daqqi was recorded as an online-Egypt lead, the Daqqi team never saw them,
// and the CRM's branch filter showed no walk-in interest from the website.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeBranch, branchIdForBranch } = require('../lib/branches');
const { branchForCountry } = require('../lib/clientContext');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map(line => line.replace(/(^|\s)\/\/[^\n]*/, '$1'))
  .join('\n');

test('geolocation cannot name a physical branch, which is why the answer mattered', () => {
  assert.equal(branchForCountry('EG'), 'ONLINE_EGYPT');
  assert.equal(branchForCountry('SA'), 'ONLINE_SAUDI');
  assert.equal(branchForCountry('US'), 'ONLINE_ABROAD');
  // No country resolves to a branch anyone can walk into.
  for (const code of ['EG', 'SA', 'US', 'AE', null]) {
    assert.ok(!['DAQQI', 'TAGAMOA'].includes(branchForCountry(code)));
  }
});

test('the values the public dropdowns emit all resolve to a real branch', () => {
  // The ids in the fallback lists on Home, BundleDetails and CourseDetails.
  const emitted = {
    daqqi: 'DAQQI',
    tagamoa: 'TAGAMOA',
    'online-egypt': 'ONLINE_EGYPT',
    'online-saudi': 'ONLINE_SAUDI',
    'online-abroad': 'ONLINE_ABROAD',
    other: 'OTHER',
  };
  for (const [picked, expected] of Object.entries(emitted)) {
    assert.equal(normalizeBranch(picked, null), expected, `the form offers "${picked}"`);
  }
  // The two physical ones carry their own branch_id, which is what the CRM's
  // branch filter and the sales-rep round-robin key on.
  assert.equal(branchIdForBranch('daqqi'), 'branch-daqqi');
  assert.equal(branchIdForBranch('tagamoa'), 'branch-tagamoa');
  // Anything unrecognised still falls through to the geo value rather than
  // being written raw — a public body must not choose its own branch string.
  assert.equal(normalizeBranch('not-a-branch', null), null);
  assert.equal(normalizeBranch('', null), null);
});

test('the registrations route honours the choice and falls back to geo', () => {
  const route = codeOnly(read('api/routes/lead-capture-crm.js'));
  assert.ok(!route.includes('branch: _branch'), 'the chosen branch is still discarded');
  assert.match(route, /const branchVal = normalizeBranch\(pickedBranch, null\) \|\| clientContext\.branch;/);
});

test('the public forms really do offer a physical branch', () => {
  for (const rel of ['client/pages/Home.tsx', 'client/pages/BundleDetails.tsx']) {
    const page = codeOnly(read(rel));
    assert.match(page, /value="daqqi"/, `${rel} no longer offers a physical branch`);
    assert.match(page, /value="tagamoa"/);
  }
});
