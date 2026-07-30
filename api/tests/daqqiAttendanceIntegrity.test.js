'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const route = fs.readFileSync(path.join(root, 'api/routes/daqqi-rounds.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'api/migrations/158_v25_daqqi_attendance_events.sql'), 'utf8');

test('Dokki attendance is an immutable session event, not a client-side counter update', () => {
  assert.match(migration, /UNIQUE KEY uq_daqqi_attendance_event[\s\S]*tenant_id, round_id, subscriber_id, session_number/);
  assert.match(route, /INSERT INTO daqqi_attendance_events/);
  assert.match(route, /DAQQI_ATTENDANCE_MARKED/);
  assert.match(route, /SELECT id,status,current_lecture FROM daqqi_rounds[\s\S]{0,180}FOR UPDATE/);
  assert.match(route, /Attendance is already recorded for this session/);
  assert.match(ui, /\/api\/admin\/daqqi-rounds\/\$\{encodeURIComponent\(roundId\)\}\/attendance/);
});

test('round edits cannot overwrite or remove persisted attendance history', () => {
  assert.match(route, /persistedAttendance/);
  assert.match(route, /An attendee with attendance history cannot be removed from a round/);
  assert.match(route, /Cannot transfer an attendee after attendance has started/);
  assert.doesNotMatch(route, /const attendedLectures = Number\(a\.attendedLectures/);
});
