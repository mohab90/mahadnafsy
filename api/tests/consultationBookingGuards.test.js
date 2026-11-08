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
  for (const route of ['api/routes/payment-proofs.js', 'api/routes/lead-capture-crm.js', 'api/routes/public-orders.js']) {
    // Looked up by id alone, any slot id was accepted, and its meeting_link — a
    // private join URL — was copied onto the customer's consultation and handed
    // straight back by GET /api/me/consultations.
    assert.ok(!codeOnly(read(route)).includes('FROM therapist_slots WHERE id=? LIMIT 1'), `${route} resolves a slot by id alone`);
  }
  const lookup = lib.slice(lib.indexOf('FROM therapist_slots'), lib.indexOf('FROM therapist_slots') + 400);
  assert.match(lookup, /s\.therapist_id=\?/);
  assert.match(lookup, /s\.is_active=1/);
  assert.match(lookup, /t\.tenant_id=\?/);
  // And it is only attempted when the order actually names a therapist.
  assert.match(lib, /if \(!slotId \|\| !therapistId\) return null;/);
});



test('neither booking page offers a day that has already gone', () => {
  // Two entry points reach the same booking — the clinic list and an
  // instructor's own page — and both hand the date to /checkout in the URL.
  for (const page of ['client/pages/Consultations.tsx', 'client/pages/InstructorDetails.tsx']) {
    assert.match(codeOnly(read(page)), /<input type="date" min=\{cairoDateOnly\(\)\}/,
      `${page} still offers a past day`);
  }
});


