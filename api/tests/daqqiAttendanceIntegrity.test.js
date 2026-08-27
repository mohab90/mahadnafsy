'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const route = fs.readFileSync(path.join(root, 'api/routes/daqqi-rounds.js'), 'utf8');
// The Dokki schedule is two files since the table was split: the tab owns the
// rounds and the writes, the row renders one round and its attendees.
const scheduleTab = fs.readFileSync(path.join(root, 'admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'admin/pages/dashboard/tabs/daqqi/DaqqiRoundRow.tsx'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'api/migrations/158_v25_daqqi_attendance_events.sql'), 'utf8');
const attendanceTab = fs.readFileSync(path.join(root, 'admin/pages/dashboard/tabs/DaqqiAttendanceTab.tsx'), 'utf8');
const privacyService = fs.readFileSync(path.join(root, 'api/lib/privacyService.js'), 'utf8');
const { getDaqqiAttendees } = require('../lib/daqqiAttendees');

// Records the SQL getDaqqiAttendees issues and replays a canned result set.
function mockDb(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return [rows];
    },
  };
}

test('Dokki attendance is an immutable session event, not a client-side counter update', () => {
  assert.match(migration, /UNIQUE KEY uq_daqqi_attendance_event[\s\S]*tenant_id, round_id, subscriber_id, session_number/);
  assert.match(route, /INSERT INTO daqqi_attendance_events/);
  assert.match(route, /DAQQI_ATTENDANCE_MARKED/);
  assert.match(route, /SELECT id,status,current_lecture FROM daqqi_rounds[\s\S]{0,180}FOR UPDATE/);
  assert.match(route, /Attendance is already recorded for this session/);
  assert.match(scheduleTab, /\/api\/admin\/daqqi-rounds\/\$\{encodeURIComponent\(roundId\)\}\/attendance/);
});

test('round edits cannot overwrite or remove persisted attendance history', () => {
  assert.match(route, /persistedAttendance/);
  assert.match(route, /An attendee with attendance history cannot be removed from a round/);
  assert.match(route, /Cannot transfer an attendee after attendance has started/);
  assert.doesNotMatch(route, /const attendedLectures = Number\(a\.attendedLectures/);
});

// ── Archiving a client must not retract their round history ──────────────────
// DELETE /api/admin/subscribers/:id archives (is_active=0 + deleted_at) rather
// than deleting, precisely so payments, enrolments and history survive.
// getDaqqiAttendees used to inner-join "s.deleted_at IS NULL", so archiving one
// client silently dropped them from every round they had ever been booked into
// — finished rounds with recorded attendance included. Every count built on this
// query then under-reported, achieving through a side door exactly the erasure
// the round/attendee delete paths refuse head-on.

test('an archived client is not filtered out of their own round history', async () => {
  const db = mockDb();
  await getDaqqiAttendees(db, 'tenant-a', ['round-1']);
  const { sql } = db.calls[0];
  assert.ok(/LEFT JOIN\s+subscribers/.test(sql), 'subscribers must not gate the attendee row');
  assert.ok(
    !sql.includes('AND s.deleted_at IS NULL'),
    'archiving a client must not remove them from rounds they were booked into',
  );
});

test('the attendee row survives even a hard-deleted subscriber, via the booking snapshot', async () => {
  const db = mockDb();
  await getDaqqiAttendees(db, 'tenant-a', ['round-1']);
  const { sql } = db.calls[0];
  assert.ok(sql.includes('COALESCE(s.name, da.name) AS name'));
  assert.ok(sql.includes('COALESCE(s.phone, da.phone) AS phone'));
  assert.ok(sql.includes('(s.id IS NULL OR s.deleted_at IS NOT NULL) AS archived'));
});

test('tenant scope and round filtering are unchanged by the archived fix', async () => {
  const db = mockDb();
  await getDaqqiAttendees(db, 'tenant-a', ['round-1', 'round-2']);
  const { sql, params } = db.calls[0];
  assert.ok(sql.includes('da.tenant_id=? AND da.round_id IN (?,?)'));
  assert.deepEqual(params, ['tenant-a', 'round-1', 'round-2']);
  assert.ok(
    /LEFT JOIN\s+subscribers[\s\S]*?s\.tenant_id=da\.tenant_id/.test(sql),
    'the relaxed join must still be tenant-scoped',
  );
});

test('no query is issued when there are no rounds', async () => {
  const db = mockDb();
  assert.deepEqual(await getDaqqiAttendees(db, 'tenant-a', []), []);
  assert.equal(db.calls.length, 0);
});

test('an archived attendee is returned and flagged, not omitted', async () => {
  const db = mockDb([
    { round_id: 'r1', subscriber_id: 's1', name: 'A', phone: '1', attended_lectures: 3, archived: 0, amount_paid: 100 },
    { round_id: 'r1', subscriber_id: 's2', name: 'B', phone: '2', attended_lectures: 2, archived: 1, amount_paid: 50 },
  ]);
  const rows = await getDaqqiAttendees(db, 'tenant-a', ['r1']);
  assert.equal(rows.length, 2, 'the archived client is still an attendee of the round');
  assert.equal(Number(rows.find(r => r.subscriber_id === 's2').archived), 1);
});

test('every consumer of getDaqqiAttendees carries the archived flag through', () => {
  // The round list, the attendance report, the CSV export and the monthly
  // aggregate all read these rows. If one drops archived attendees its numbers
  // stop agreeing with the others.
  const flagged = route.match(/archived: Boolean\(Number\(a\.archived \|\| 0\)\)/g) || [];
  assert.equal(flagged.length, 2, 'round list and attendance report both expose archived');
  assert.ok(route.includes('archivedAttendeeCount: atts.filter(a => Number(a.archived || 0) === 1).length'));
  assert.ok(route.includes("'نسبة الحضور%', 'حالة العميل']"), 'CSV export carries a client-status column');
  assert.ok(route.includes("Number(a.archived || 0) === 1 ? 'مؤرشف' : 'نشط'"));
});

test('archiving is neither a way to book a client nor a way to drop a booked one', () => {
  // The round upsert deletes and re-inserts daqqi_attendees. Re-inserting a
  // client who has since been archived must succeed — otherwise the round can
  // never be edited again (their attendance trips the removal guard), or their
  // row is silently lost. Booking a *new* archived client stays refused.
  assert.ok(route.includes('const alreadyBooked = persistedAttendance.has(String(subId));'));
  assert.ok(route.includes("WHERE s.id=? AND s.tenant_id=?${alreadyBooked ? '' : ' AND s.deleted_at IS NULL'}"));
  assert.match(route, /An archived client cannot be booked into a round/);
});

test('the booking snapshot cannot resurface privacy-erased contact details', () => {
  // getDaqqiAttendees falls back to the daqqi_attendees name/phone snapshot when
  // the subscriber row is gone. That is only safe while privacy erasure scrubs
  // both sides: erasure nulls subscribers.phone, so a snapshot left un-erased
  // would be handed straight back through the COALESCE.
  assert.match(
    privacyService,
    /UPDATE subscribers SET[\s\S]{0,200}phone=NULL/,
    'erasure must clear the live subscriber phone',
  );
  assert.match(
    privacyService,
    /UPDATE daqqi_attendees SET name=\?,phone=NULL/,
    'erasure must clear the attendee snapshot too, or the fallback leaks it back',
  );
});

test('the UI labels archived attendees rather than hiding them', () => {
  assert.match(ui, /a\.archived &&[\s\S]{0,240}مؤرشف/);
  assert.match(attendanceTab, /att\.archived &&[\s\S]{0,240}مؤرشف/);
  assert.match(attendanceTab, /archivedAttendeeCount/);
});
