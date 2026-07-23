'use strict';
/**
 * Behavioral tests for lib/courseCompletion.js — the previous version of this
 * file only asserted that certain regex patterns existed in the SOURCE TEXT
 * (e.g. `assert.match(service, /LIMIT 1 FOR UPDATE/)`), which passes even if
 * the actual runtime logic is wrong, since nothing here ever executed the
 * code. These tests call completeCourse()/completeCourses() with a mock
 * connection (courseCompletion.js already supports dependency injection via
 * its optional `db` param) and assert on real return values, thrown errors,
 * and the exact queries issued — the class of test that would have caught
 * the "payment succeeds but the customer never gets enrolled" bug class
 * (see the payment→enrollment lifeline test in publicOrdersFulfillment.test.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { completeCourse, completeCourses } = require('../lib/courseCompletion');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

// Minimal mock connection: routes each conn.query() call by matching a
// substring of the SQL against a caller-supplied table of {match, rows}.
// Records every call so tests can assert on exact params issued.
function mockConn(responses) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const hit = responses.find(r => sql.includes(r.match));
      if (!hit) throw new Error(`mockConn: no canned response configured for query: ${sql.slice(0, 80)}...`);
      return [hit.rows];
    },
  };
}

test('completeCourse: rejects with 409 when there is no paid tenant enrollment', async () => {
  const conn = mockConn([
    { match: 'FROM subscribers s', rows: [] }, // eligibility query finds nothing
  ]);
  await assert.rejects(
    () => completeCourse({ tenantId: 't1', subscriberId: 's1', courseId: 'c1' }, conn),
    (err) => { assert.equal(err.statusCode, 409); assert.match(err.message, /Paid tenant enrollment is required/); return true; }
  );
  // Confirms the eligibility check is actually the FIRST and only query run —
  // no premature write happens before eligibility is confirmed.
  assert.equal(conn.calls.length, 1);
});

test('completeCourse: requireFullProgress=true rejects when lectures are incomplete', async () => {
  const conn = mockConn([
    { match: 'FROM subscribers s', rows: [{ subscriber_id: 's1', name: 'Test', email: 't@x.com', course_id: 'c1', title: 'Course', price_egp: 100, enrollment_id: 'e1' }] },
    { match: 'FROM course_lectures', rows: [{ total: 5, completed: 3 }] },
  ]);
  await assert.rejects(
    () => completeCourse({ tenantId: 't1', subscriberId: 's1', courseId: 'c1', requireFullProgress: true }, conn),
    (err) => { assert.equal(err.statusCode, 409); assert.match(err.message, /All published lectures must be completed/); return true; }
  );
});

test('completeCourse: requireFullProgress=true succeeds once all lectures are done, and records tenant_id on the completion row', async () => {
  const conn = mockConn([
    { match: 'FROM subscribers s', rows: [{ subscriber_id: 's1', name: 'Test', email: 't@x.com', course_id: 'c1', title: 'Course', price_egp: 100, enrollment_id: 'e1' }] },
    { match: 'FROM course_lectures', rows: [{ total: 5, completed: 5 }] },
    { match: 'FROM course_completions', rows: [] }, // not already completed
    { match: 'INSERT INTO course_completions', rows: [] },
    { match: 'INSERT INTO message_outbox', rows: [] },
  ]);
  const result = await completeCourse({ tenantId: 'tenant-x', subscriberId: 's1', courseId: 'c1', requireFullProgress: true }, conn);
  assert.equal(result.alreadyCompleted, false);
  assert.ok(result.certificate_code);

  const insertCall = conn.calls.find(c => c.sql.includes('INSERT INTO course_completions'));
  assert.ok(insertCall, 'must actually write a course_completions row, not just return success');
  assert.equal(insertCall.params[1], 's1');
  assert.equal(insertCall.params[2], 'c1');
  assert.equal(insertCall.params[4], 'tenant-x', 'completion row must carry the tenant_id, not the default tenant');

  const outboxCall = conn.calls.find(c => c.sql.includes('INSERT INTO message_outbox'));
  assert.ok(outboxCall, 'a completion notification must be enqueued through the outbox (retryable), not sent inline');
});

test('completeCourse: already-completed is idempotent — returns the existing certificate, does not insert a duplicate', async () => {
  const conn = mockConn([
    { match: 'FROM subscribers s', rows: [{ subscriber_id: 's1', name: 'Test', email: 't@x.com', course_id: 'c1', title: 'Course', price_egp: 0, enrollment_id: 'e1' }] },
    { match: 'FROM course_completions', rows: [{ id: 'cc1', certificate_code: 'MHAD-EXISTING', completed_at: '2026-01-01' }] },
  ]);
  const result = await completeCourse({ tenantId: 't1', subscriberId: 's1', courseId: 'c1' }, conn);
  assert.equal(result.alreadyCompleted, true);
  assert.equal(result.certificate_code, 'MHAD-EXISTING');
  assert.ok(!conn.calls.some(c => c.sql.includes('INSERT INTO course_completions')), 'must not write a second completion row');
});

test('completeCourses: rejects out-of-bounds batch sizes (0 or >500) before touching the database', async () => {
  await assert.rejects(() => completeCourses({ tenantId: 't1', subscriberIds: [], courseId: 'c1' }), { statusCode: 400 });
  await assert.rejects(() => completeCourses({ tenantId: 't1', subscriberIds: Array.from({ length: 501 }, (_, i) => `s${i}`), courseId: 'c1' }), { statusCode: 400 });
});

// Static contract checks below: things that are cheap and legitimate to check
// as source-text patterns because they're wiring/permission facts, not
// business logic — the behavior itself is covered by the tests above.
test('admin completion route requires manage_courses permission and passes tenantId through', () => {
  const route = read('routes/lms.js');
  assert.match(route, /router\.post\('\/api\/admin\/completions'[^\n]+requirePermission\('manage_courses'\)/);
  assert.match(route, /completeCourse\(\{[\s\S]*tenantId: req\.tenantId/);
  assert.match(route, /completeCourses\(\{[\s\S]*tenantId: req\.tenantId/);
});

test('live sessions and waitlists are tenant owned and notify through the outbox', () => {
  const route = read('routes/lms.js');
  const migration = read('migrations/083_v25_lms_sequence_tenant_scope.sql');
  assert.match(migration, /ALTER TABLE live_sessions[\s\S]*tenant_id/);
  assert.match(migration, /ALTER TABLE course_waitlist[\s\S]*tenant_id/);
  assert.match(route, /INSERT INTO live_sessions \(id, tenant_id/);
  assert.match(route, /WHERE id=\? AND tenant_id=\?/);
});
