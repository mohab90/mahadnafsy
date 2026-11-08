'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const route = fs.readFileSync(path.join(root, 'api/routes/admin/subscribers.js'), 'utf8');
const matching = fs.readFileSync(path.join(root, 'api/lib/leadMatching.js'), 'utf8');

// The subscriber save had no contact validation, which is how nine clients on
// production ended up with neither a phone nor a usable email — unreachable, and
// unable to sign in by either route.

const createBlock = (() => {
  const start = route.indexOf('A new client needs a way to be reached');
  assert.ok(start > -1, 'the contact guard must exist');
  return route.slice(start, start + 2200);
})();

test('a new subscriber must carry a phone or an email', () => {
  assert.ok(createBlock.includes('!safePhone && !safeEmail'),
    'creation must reject a record with neither identifier');
  assert.ok(createBlock.includes('res.status(400)'),
    'it must be rejected, not silently saved');
});

test('a new subscriber must carry a name', () => {
  // One of the nine has no name at all.
  assert.ok(createBlock.includes('!safeName'), 'creation must reject a nameless record');
});

test('the guard applies to creation only, so the damaged rows stay editable', () => {
  // Editing them is how the desk repairs them. A rule that covered updates too
  // would make the existing nine permanently unfixable through the UI.
  assert.ok(createBlock.includes('if (!existingRow) {'),
    'the guard must be conditional on the row not already existing');
  assert.ok(/SELECT id FROM subscribers WHERE id = \? AND tenant_id = \?/.test(createBlock),
    'existence must be checked against this tenant, not globally');
});




