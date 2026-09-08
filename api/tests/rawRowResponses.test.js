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

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8');
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

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
  assert.match(schema, /`status` enum\('PENDING','CONFIRMED','COMPLETED','CANCELLED'\)/,
    'if this enum stops being upper case the mapping above needs revisiting');
});

test('a live stream reaches the customer in the shape the screen reads', () => {
  const handler = handlerFor('/api/live-streams');
  for (const field of ['instructorName', 'scheduledAt', 'streamUrl', 'durationMinutes', 'targetCourseIds']) {
    assert.match(handler, new RegExp(`${field}:`), `${field} must be mapped`);
  }
  assert.match(handler, /status: String\(row\.status \|\| ''\)\.toLowerCase\(\)/);
  assert.doesNotMatch(handler, /res\.json\(visible\)/, 'the raw rows must not go out');
});

test('the screens still read the names being sent', () => {
  // The mapping is only correct relative to what the component asks for, so the
  // component is the other half of this assertion.
  const consultations = codeOnly(read('client/components/student-dashboard/StudentConsultationsTab.tsx'));
  assert.match(consultations, /consultation\.meetingLink/);
  assert.match(consultations, /consultation\.status === 'confirmed'/);

  const live = codeOnly(read('client/components/student-dashboard/StudentLiveStreamsTab.tsx'));
  assert.match(live, /\.status === 'live'/);
  assert.match(live, /\.scheduledAt/);
  assert.match(live, /\.streamUrl/);
});

test('the session time is read as written, not converted', () => {
  // The server runs in UTC and the connection sets no timezone, so the stored
  // value is the wall clock the desk typed. The admin slices the string; a
  // conversion here would show the customer a different hour from the one the
  // person who booked them is looking at.
  const tab = codeOnly(read('client/components/student-dashboard/StudentConsultationsTab.tsx'));
  assert.doesNotMatch(tab, /toLocaleDateString|toLocaleTimeString|toLocaleString/);
  assert.match(tab, /const formatSession/);
});

test('the certificates tab was already correct and stays that way', () => {
  const mappers = codeOnly(read('api/lib/mappers.js'));
  assert.match(mappers, /status: String\(cr\.status \|\| 'pending'\)\.toLowerCase\(\)/);
});

test('the two unreachable endpoints are gone', () => {
  // Neither had a caller in either app, the e2e suite or the tools. One of them
  // also identified the caller by email alone.
  const lms = codeOnly(read('api/routes/lms.js'));
  assert.doesNotMatch(lms, /router\.get\('\/api\/me\/cohorts'/);
  assert.doesNotMatch(lms, /router\.get\('\/api\/me\/live-sessions'/);
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
  assert.match(tab, /attempt\.quizId === quiz\.id && attempt\.subscriberId === subscriber\.id/);
});

test('the completions list is read snake_case on purpose and stays that way', () => {
  // Checked rather than assumed: this route also hands over a raw row, but the
  // screen reads c.course_id to match. Mapping it would break the pairing.
  const tab = codeOnly(read('client/components/student-dashboard/StudentCertificatesTab.tsx'));
  assert.match(tab, /completions\.find\(c => c\.course_id === String\(course\.id\)\)/);
});

test('the dashboard finds a customer who has no email address', () => {
  // It resolved the subscriber by matching authUser.email against the list.
  // 19 customer accounts on production have no email — everyone who signed up
  // through WhatsApp, and anyone who left the optional field blank — so for
  // them the match failed and the whole page fell through to «لم تنضم بعد إلى
  // أي كورس»: no courses, certificates, payments, quizzes or consultations,
  // while they were paid up the entire time. mySubscriberId is resolved
  // server-side for exactly this, and the other screens already used it.
  const dashboard = codeOnly(read('client/pages/UserDashboard.tsx'));
  assert.match(dashboard, /subscribers\.find\(s => s\.id === mySubscriberId\)/);
  assert.match(dashboard, /mySubscriberId, isAdmin/, 'it has to be pulled off the context');
  assert.doesNotMatch(dashboard, /const subscriber = authUser\?\.email/,
    'the email-only resolution must be gone');
});

test('the consultations list is not filtered again on the client', () => {
  // /api/me/consultations is scoped to the caller server-side and has never
  // sent clientEmail. Filtering on it discarded every row, so the tab, the
  // sidebar stat, the overview card and the badge all read zero.
  const dashboard = codeOnly(read('client/pages/UserDashboard.tsx'));
  assert.match(dashboard, /const userConsultations = consultations;/);
  assert.doesNotMatch(dashboard, /c\.clientEmail\?\.toLowerCase\(\)/);

  // And the route must keep sending what the client sorts on.
  assert.match(handlerFor('/api/me/consultations'), /createdAt: row\.created_at/);
});
