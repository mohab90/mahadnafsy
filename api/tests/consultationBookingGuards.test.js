'use strict';

// Booking a consultation carries two values the customer controls through the
// URL — the date and the slot id — and neither was checked.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map(line => line.replace(/(^|\s)\/\/.*$/, '$1'))
  .join('\n');

test('the slot lookup is scoped to the therapist on the order and to this tenant', () => {
  const route = codeOnly(read('api/routes/payment-proofs.js'));

  // Looked up by id alone, any slot id was accepted, and its meeting_link — a
  // private join URL — was copied onto the customer's consultation and handed
  // straight back by GET /api/me/consultations.
  assert.ok(
    !route.includes("FROM therapist_slots WHERE id=? LIMIT 1"),
    'the slot is still resolved by id alone'
  );
  const lookup = route.slice(route.indexOf('FROM therapist_slots'), route.indexOf('FROM therapist_slots') + 400);
  assert.match(lookup, /s\.therapist_id=\?/);
  assert.match(lookup, /s\.is_active=1/);
  assert.match(lookup, /t\.tenant_id=\?/);
  // And it is only attempted when the order actually names a therapist.
  assert.match(route, /if \(extra\.slotId && extra\.therapistId\)/);
});

test('a session date in the past is refused, on the Cairo day', () => {
  const route = codeOnly(read('api/routes/lead-capture-crm.js'));
  assert.match(route, /SESSION_DATE_INVALID/);
  assert.match(route, /SESSION_DATE_PAST/);
  assert.match(route, /sessionDate < dateOnlyInTimeZone\(\)/);
  // The route has to be able to reach the helper.
  assert.match(route, /require\('\.\.\/lib\/dates'\)/);
});

test('neither booking page offers a day that has already gone', () => {
  // Two entry points reach the same booking — the clinic list and an
  // instructor's own page — and both hand the date to /checkout in the URL.
  for (const page of ['client/pages/Consultations.tsx', 'client/pages/InstructorDetails.tsx']) {
    assert.match(codeOnly(read(page)), /<input type="date" min=\{cairoDateOnly\(\)\}/,
      `${page} still offers a past day`);
  }
});

test('the date the customer picks still reaches the order untouched', () => {
  // The guard must not have changed what is stored: the desk and the customer
  // both read the wall-clock the booking page showed.
  const proofs = codeOnly(read('api/routes/payment-proofs.js'));
  assert.match(proofs, /\$\{extra\.sessionDate\} \$\{String\(bookedSlot\.start_time\)\.slice\(0, 5\)\}:00/);
});
