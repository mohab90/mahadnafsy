'use strict';
// Four faults found by reading the admin side of two classes already proven on
// the customer side.
//
// Two are the raw-row class: a route hands over a database row spelled the way
// the table spells it, the screen reads camelCase, and the cast to the screen's
// own type means nothing complains. Two are money: what a customer owes, and
// which day a payment belongs to.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8');
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

// ── the consultations screen in the admin ──────────────────────────────────
test('an admin consultation is sent in the shape every consultations screen reads', () => {
  // The whole screen was drawing empty: client, doctor and type all «—», the
  // date «بدون تاريخ», the calendar blank in every month, and «تأكيد» never
  // rendered. The therapist portal maps this same table correctly, so the
  // shape already existed in the codebase — this route was the one missed.
  const source = codeOnly(read('routes/core/staffacct.js'));
  for (const field of ['clientName', 'clientPhone', 'therapistName', 'therapistId', 'sessionDate', 'meetingLink']) {
    assert.match(source, new RegExp(field + ':'), field + ' must be mapped');
  }
  assert.doesNotMatch(source, /res\.json\(rows\)/, 'the raw rows must not go out');
});

test('its status and session type are lower-cased, because both enums are upper', () => {
  const source = codeOnly(read('routes/core/staffacct.js'));
  assert.match(source, /status: String\(row\.status \|\| 'PENDING'\)\.toLowerCase\(\)/);
  assert.match(source, /sessionType: String\(row\.session_type \|\| 'INDIVIDUAL'\)\.toLowerCase\(\)/);
  assert.match(read('schema.sql'), /`session_type` enum\('INDIVIDUAL','COUPLE','FAMILY'\)/,
    'if this enum stops being upper case the mapping above needs revisiting');
});

// ── contact messages ───────────────────────────────────────────────────────
test('a contact message carries its date, its note and a comparable status', () => {
  const source = codeOnly(read('routes/admin-operations.js'));
  const handler = source.slice(source.indexOf("'/api/admin/contact-messages'"));
  assert.match(handler.slice(0, 1600), /createdAt: row\.created_at/);
  assert.match(handler.slice(0, 1600), /adminNote: row\.admin_note/);
  assert.match(handler.slice(0, 1600), /status: String\(row\.status \|\| 'NEW'\)\.toLowerCase\(\)/);
});

test('and the note the desk types is actually saved', () => {
  // The screen has always offered the field; the route wrote only the status,
  // so the note was accepted on screen and dropped on the way past.
  const source = codeOnly(read('routes/admin-operations.js'));
  const patch = source.slice(source.indexOf("router.patch('/api/admin/contact-messages/:id'"));
  const handler = patch.slice(0, patch.indexOf('\n});'));
  assert.match(handler, /req\.body\.adminNote/);
  assert.match(handler, /admin_note=\?/);
  assert.doesNotMatch(handler, /SET status=\? WHERE/, 'status must no longer be the only column written');
});

// ── what an instalment says the customer owes ──────────────────────────────
test('an instalment records the plan total, not its own amount', () => {
  // course_expected is what the customer owes for the course, and the
  // collections query reads MAX(course_expected) per course to decide who is
  // still short. Writing one instalment's amount there made expected equal
  // paid the moment that instalment cleared, so a customer part-way through a
  // plan dropped off the outstanding list and was never chased again.
  const source = codeOnly(read('routes/installments.js'));
  const insert = source.slice(source.indexOf('INSERT INTO payments'));
  assert.match(insert.slice(0, 1200), /plan\.total_amount/);
  assert.doesNotMatch(insert.slice(0, 1200), /update\.scheduledAmount/);
});

test('the collections query still reads that column, so the fix reaches it', () => {
  // The two halves only work together; if the query stops reading
  // course_expected this test should fail and be re-thought, not deleted.
  const collections = codeOnly(read('routes/crm-tools.js'));
  assert.match(collections, /MAX\(COALESCE\(course_expected,0\)/);
});

// ── which day a payment belongs to ─────────────────────────────────────────
test('an instalment is dated in Cairo, not in the server timezone', () => {
  // The server runs in UTC. toISOString() on the server clock dated a payment
  // confirmed at 01:30 Cairo to the previous day, filing it and its journal
  // entry in the wrong month — and, if that month is closed, failing the write
  // outright. lib/finance.js records 179 entries already filed a day early.
  const source = codeOnly(read('routes/installments.js'));
  assert.match(source, /const effectiveDate = paidDate \|\| dateOnlyInTimeZone\(\)/);
  assert.doesNotMatch(source, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
  assert.match(source, /require\('\.\.\/lib\/dates'\)/);
});

test('the timezone helper still defaults to Cairo', () => {
  assert.match(read('lib/dates.js'), /timeZone = 'Africa\/Cairo'/);
});
