'use strict';
// Which access types open a lecture.
//
// resolveLectureAccess tested for 'limited' and let everything that was not
// 'limited' fall through to accessible — so 'preview' opened the whole course.
// In the admin it reads «غير مفعل», and normalizeAccess returns it for an
// enrolment with no access setting at all: it is the absence of a grant. Nine
// active enrolments carried it, on courses priced 3,400 to 5,600, having paid
// 900 EGP between them.
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'learningAccess.js'), 'utf8');
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n');

test('access is an allow-list, so an unhandled type is refused', () => {
  assert.match(
    code,
    /access_type !== 'full' && lecture\.access_type !== 'limited'/,
    'the check must name what opens, not what closes',
  );
  // The refusal has to come before the limited branch, or a preview enrolment
  // reaches the drip check and returns accessible.
  const guard = code.indexOf("!== 'full'");
  const limited = code.indexOf("access_type === 'limited'");
  assert.ok(guard > 0 && limited > 0);
  assert.ok(guard < limited, 'the allow-list must gate before the limit branch');
});

test('the refusal is named, not silent', () => {
  // The client renders a reason; an unnamed refusal shows as a blank player.
  assert.match(code, /reason: 'not_activated'/);
});

test('a limited enrolment is still measured by position, not by guesswork', () => {
  assert.match(code, /position >= limit/);
  assert.match(code, /reason: 'access_limited'/);
});

test('the media route still re-checks the enrolment behind the ticket', () => {
  // The ticket proves who is asking; the join proves they are enrolled. A
  // ticket alone must never be the whole authorisation.
  const lms = fs.readFileSync(path.join(__dirname, '..', 'routes', 'lms.js'), 'utf8');
  const route = lms.slice(lms.indexOf("'/api/media/lectures/:lectureId'"));
  assert.match(route.slice(0, 1200), /verifyMediaTicket/);
  assert.match(route.slice(0, 1200), /JOIN enrollments/);
  assert.match(route.slice(0, 1200), /e\.status='active'/);
});
