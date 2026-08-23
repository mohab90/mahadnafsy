'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');

// ── What migration 207 actually fixed: nothing user-visible ──────────────────
//
// Its header claims four clients could not log in with their own email address.
// That is wrong twice over, and this is the correction. The file itself is left
// alone: it is applied on production and the runner checksums the whole file,
// comments included, so editing a word would report drift on a migration nobody
// touched.
//
// The finding was real — four subscribers had an email stored with a leading
// space, ' name@gmail.com'. Neither conclusion drawn from it was.
//
//   1. All four have an active users row with a password, and users.email was
//      never padded: zero rows out of 1,654. Signing in by email worked for them
//      throughout. The "locked out" reading came from a test that sent a
//      deliberately wrong password and treated plain "Invalid credentials" as
//      "account not found". For an account that has a password, that response is
//      simply correct.
//
//   2. The padding would not have hidden them even without a users row. Every
//      email lookup in routes/auth.js already normalises both sides —
//      LOWER(TRIM(email)) — so a padded row matches a cleanly typed address.
//      That is a deliberate choice: it costs the index on a low-frequency
//      operation and buys tolerance of exactly this kind of data.
//
// So the migration is hygiene, not a fix. Worth keeping — a padded address is
// wrong data, and not every consumer of these columns normalises the way auth
// does — but it repaired no broken login, and the tests below assert what is
// actually true rather than what the header says.

test('auth email lookups normalise both sides, which is why padding never hid an account', () => {
  const auth = fs.readFileSync(path.join(root, 'api/routes/auth.js'), 'utf8');
  const normalised = (auth.match(/LOWER\(TRIM\(email\)\)/g) || []).length;
  assert.ok(normalised >= 4,
    `expected auth lookups to compare LOWER(TRIM(email)); found ${normalised}`);
});

test('the subscriber write paths trim contact fields', () => {
  const src = fs.readFileSync(path.join(root, 'api/routes/admin/subscribers.js'), 'utf8');
  // Cleaning the data is only durable if nothing re-introduces a padded value.
  const trimmedEmailWrites = (src.match(/email[^;\n]*\.trim\(\)/g) || []).length;
  assert.ok(trimmedEmailWrites >= 3,
    `expected the subscriber routes to trim email on write, found ${trimmedEmailWrites} site(s)`);
});

test('migration 207 is idempotent', () => {
  const sql = fs.readFileSync(path.join(root, 'api/migrations/207_v26_trim_contact_fields.sql'), 'utf8');
  const updates = sql.match(/UPDATE\s+\w+\s+SET/gi) || [];
  assert.ok(updates.length >= 6, 'expected an UPDATE per contact column');
  // Every statement must be guarded, or a re-run rewrites rows it need not touch
  // and stamps updated_at across the table.
  const guarded = sql.match(/WHERE\s+\w+\s+IS NOT NULL AND \w+ <> TRIM\(\w+\)/gi) || [];
  assert.equal(guarded.length, updates.length,
    'every UPDATE needs a WHERE that matches nothing once the data is clean');
});
