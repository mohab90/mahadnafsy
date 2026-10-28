'use strict';

// One writer decides who gets access to a course.
//
// api/lib/entitlements.js is the authority: it applies the access policy (full
// or limited by the proportion paid), refuses to lower a grant somebody already
// holds, records entitlement_source, granted_by, an expiry from the course's
// access_months, and an entitlement_events audit row.
//
// The Paymob confirmation had its own INSERT. It wrote access_type='full'
// whatever had been paid, recorded none of that, and its ON DUPLICATE KEY
// UPDATE set access_type='full' unconditionally — so it would raise a
// deliberately limited grant to full, the one move the authority exists to
// refuse. 1,533 of the enrolments on production record no reason for existing,
// and this was the last writer that could still add to them.
//
// Run: npm run test:unit

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

function apiSources() {
  const out = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'tests' || entry.name === 'migrations') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.js$/.test(entry.name)) out.push(full);
    }
  };
  walk(path.join(ROOT, 'api'));
  return out.map(f => path.relative(ROOT, f).split(path.sep).join('/'));
}

// A grant records its source and actor, leaves an event, and is never lowered
// by a payment: tests/integration/learningAccess.integration.test.js. A Paymob
// confirmation opens the course through it (entitlement_source 'paymob_order'):
// tests/integration/publicHttpAndPaymob.integration.test.js. This scan keeps it
// the only writer.

test('only the authority writes an enrolment', () => {
  const writers = apiSources().filter(rel =>
    /INSERT\s+(?:IGNORE\s+)?INTO\s+enrollments/i.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')));
  assert.deepEqual(writers, ['api/lib/entitlements.js'],
    'these grant access without going through grantCourseEntitlement: ' + writers.join(', '));
});
