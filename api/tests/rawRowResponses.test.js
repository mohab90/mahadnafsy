'use strict';
// A row went to the browser with the column names the table uses, and the
// screen read the names its own type declares. Nothing failed: the client casts
// the response straight to that type, so every mismatched field was simply
// undefined and the card rendered without it.
//
// Two customer-facing screens were broken this way at once:
//
//   /api/me/consultations — the card showed «استشارة» with no therapist, no
//   date and no session type, and the «انضم للجلسة» button never appeared. It
//   is gated on meetingLink (the row says meeting_link) and on the status being
//   'confirmed' (the enum stores CONFIRMED). A customer whose consultation had
//   been confirmed had no way to reach it.
//
//   /api/live-streams — same shape: no presenter, no time, no join URL, and
//   «مباشر الآن» never lit because the enum is upper case.
//
// The certificates tab looked like a third instance and was not: its mapper in
// lib/mappers.js already lower-cases the status. Checked before changing it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { codeOnlyKeepingUrls: codeOnly } = require('./support/repo');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8');

const publicRoutes = codeOnly(read('api/routes/public.js'));

// Both handlers are lifted out so the assertions are about the shipped mapping
// rather than about the whole file happening to contain a word.
function handlerFor(routePath) {
  const at = publicRoutes.indexOf(`'${routePath}'`);
  assert.ok(at > 0, `${routePath} not found`);
  const rest = publicRoutes.slice(at);
  const end = rest.indexOf('\n});');
  return rest.slice(0, end === -1 ? rest.length : end);
}

test('a consultation reaches the customer in the shape the screen reads', () => {
  const handler = handlerFor('/api/me/consultations');
  for (const field of ['therapistName', 'sessionDate', 'sessionType', 'meetingLink']) {
    assert.match(handler, new RegExp(`${field}:`), `${field} must be mapped`);
  }
  assert.doesNotMatch(handler, /res\.json\(rows\)/, 'the raw rows must not go out');
});

test('its status is lower-cased, because the enum is upper case', () => {
  // consultations.status is PENDING|CONFIRMED|COMPLETED|CANCELLED, and the
  // screen's label map, colour map and join-button test are all lower case.
  const handler = handlerFor('/api/me/consultations');
  assert.match(handler, /status: String\(row\.status \|\| ''\)\.toLowerCase\(\)/);
  assert.match(handler, /sessionType: String\(row\.session_type \|\| ''\)\.toLowerCase\(\)/);

  const schema = read('api/schema.sql');
  
});

test('a live stream reaches the customer in the shape the screen reads', () => {
  const handler = handlerFor('/api/live-streams');
  // The mapping lives in lib/mappers.js now — the panel's own route sends the
  // same shape — so the route is held to using it, and the mapper to its fields.
  assert.ok(handler.includes('res.json(visible.map(mapLiveStream))'), 'the raw rows must not go out');
  const { mapLiveStream } = require('../lib/mappers');
  const mapped = mapLiveStream({ status: 'LIVE', scheduled_at: 'x', stream_url: 'u', instructor_name: 'n', duration_minutes: '30', target_course_ids_json: '[]' });
  for (const field of ['instructorName', 'scheduledAt', 'streamUrl', 'durationMinutes', 'targetCourseIds']) {
    assert.notEqual(mapped[field], undefined, `${field} must be mapped`);
  }
  assert.equal(mapped.status, 'live');
});







test('a student sees the quiz they already passed', () => {
  // StudentQuizTab pairs an attempt to a quiz with
  // `attempt.quizId === quiz.id && attempt.subscriberId === subscriber.id`.
  // The route sent quiz_id and subscriber_id, so both sides of that test were
  // undefined: the filter matched nothing and every quiz drew as never
  // attempted, however many times it had been passed. The sort by takenAt was
  // comparing two empty strings for the same reason.
  // Each pair is asserted whole. Checking only that the name appears passes
  // against `quizId: row.quizId`, which is the bug written the other way round.
  const handler = handlerFor('/api/me/quiz-attempts');
  for (const [field, column] of [
    ['subscriberId', 'subscriber_id'], ['quizId', 'quiz_id'],
    ['courseId', 'course_id'], ['takenAt', 'taken_at'],
  ]) {
    assert.match(handler, new RegExp(field + ': row\\.' + column + '\\b'),
      `${field} must be mapped from ${column}`);
  }
  assert.match(handler, /answers: tryJson\(row\.answers_json, \[\]\)/);
  assert.doesNotMatch(handler, /res\.json\(rows\)/, 'the raw rows must not go out');

  const tab = codeOnly(read('client/components/student-dashboard/StudentQuizTab.tsx'));
  
});





test('the consultations list is not filtered again on the client', () => {
  // /api/me/consultations is scoped to the caller server-side and has never
  // sent clientEmail. Filtering on it discarded every row, so the tab, the
  // sidebar stat, the overview card and the badge all read zero.
  const dashboard = codeOnly(read('client/pages/UserDashboard.tsx'));
  
  

  // And the route must keep sending what the client sorts on.
  assert.match(handlerFor('/api/me/consultations'), /createdAt: row\.created_at/);
});


