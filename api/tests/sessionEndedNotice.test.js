'use strict';
// «بيظهر اول فيديو والباقي مش بيشتغلوا … لازم اغير المتصفح».
//
// A customer account holds one session at a time, so a sign-in on a second phone
// or browser ends the first. The page left behind never found out: the free
// first lecture played, because it needs no session, and every other lecture
// answered «حاول مرة أخرى» for as long as the student kept trying. Another
// browser "fixed" it only because it meant signing in again. Production's access
// log for two days: 85 of 105 viewers hit a refused session or a stale ticket.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('a request refused for a dead session tells the rest of the site', () => {
  const api = read('client/lib/mysqlapi.ts');
  assert.match(api, /auth && res\.status === 401 && \(DEAD_SESSION_CODES\.has\(b\.code\) \|\| DEAD_SESSION_ERRORS\.has\(b\.error\)\)/);
  assert.match(api, /dispatchEvent\(new CustomEvent\(SESSION_ENDED_EVENT/);
  // Only requireAuth's answers about the session itself. A 401 about the
  // request — a wrong current password — must not sign anybody out.
  const lists = api.match(/DEAD_SESSION_CODES = new Set\(\[[^\]]*\]\)[\s\S]*?DEAD_SESSION_ERRORS = new Set\(\[[^\]]*\]\)/)[0];
  assert.doesNotMatch(lists, /Current password incorrect|Invalid credentials|Media ticket/);
  // …and each of those answers is one requireAuth really gives.
  const auth = read('api/middleware/auth.js');
  for (const answer of lists.match(/'[^']+'/g).map(s => s.slice(1, -1))) {
    assert.ok(auth.includes(`'${answer}'`), `requireAuth never answers ${answer}`);
  }
});

test('the page signs itself out and says why, including after a reload', () => {
  const context = read('client/context/AuthContext.tsx');
  assert.match(context, /addEventListener\(SESSION_ENDED_EVENT/);
  assert.match(context, /if \(!signedIn\.current\) return;[\s\S]*setSessionEnded\(true\);[\s\S]*setAuthUser\(null\)/,
    'only a page that believed it was signed in reacts');
  assert.match(context, /code === 'SESSION_REVOKED'\) setSessionEnded\(true\)/,
    'a reload after the session ended explains it too');
  assert.match(read('client/App.tsx'), /<SessionEndedNotice \/>/);
});

test('a lecture player is never handed the previous lecture\'s ticket', () => {
  // The player is keyed on the selected lecture, and the next ticket arrives
  // after the render that switches — so one render built the new player around
  // the old ticket, which then played the wrong video or failed with a 401.
  const dashboard = read('client/components/UserDashboardVideoPlayer.tsx');
  assert.match(dashboard, /const resolvedUrl = access\.lectureId === selectedId \? access\.url : ''/);
  assert.doesNotMatch(dashboard, /setResolvedUrl\(/);
  const course = read('client/pages/CourseDetails.tsx');
  assert.match(course, /const resolvedLectureUrl = resolvedLecture\.lectureId === selectedLectureId \? resolvedLecture\.url : ''/);
  assert.doesNotMatch(course, /setResolvedLectureUrl\(/);
});
