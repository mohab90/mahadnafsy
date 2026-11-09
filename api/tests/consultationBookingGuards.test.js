'use strict';

// Booking a consultation carries two values the customer controls through the
// URL — the date and the slot id — and neither was checked.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { codeOnly } = require('./support/repo');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');


test('the slot lookup is scoped to the therapist on the order and to this tenant', () => {
  // The lookup lives in lib/consultationRequests.js now, shared by the
  // checkout and both ways of paying.
  const lib = codeOnly(read('api/lib/consultationRequests.js'));
  
  const lookup = lib.slice(lib.indexOf('FROM therapist_slots'), lib.indexOf('FROM therapist_slots') + 400);
  assert.match(lookup, /s\.therapist_id=\?/);
  assert.match(lookup, /s\.is_active=1/);
  assert.match(lookup, /t\.tenant_id=\?/);
  // And it is only attempted when the order actually names a therapist.
  
});






