'use strict';

// Closing a course on somebody who stopped paying, and opening it again.
//
// An instalment buys access in proportion to what has been paid, and nothing
// closed that access when the rest never arrived: the library had
// revokeCourseEntitlement and grantCourseEntitlement, and no screen or route
// reached either. Collection and customer service are the two desks that know
// a client has stopped paying, and they hold manage_subscribers — so the
// decision is theirs, by hand, with a reason recorded against the client.
//
// Deliberately not automatic: an overdue instalment is a conversation before
// it is a lock, and a nightly job that shut people out of courses they had
// half paid for would be the wrong kind of correct.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// It lives with the two course-access routes that were already there, not with
// the payments router: the GET the panel loads and the PUT that moves the
// expiry date are its siblings.
const ROUTE = 'api/routes/core/content.js';
const PANEL = 'admin/pages/dashboard/tabs/online-clients-sections/ClientCourseAccessPanel.tsx';

test('the route is open to the two desks that use it', () => {
  const source = read(ROUTE);
  assert.match(
    source,
    /router\.post\('\/api\/admin\/subscribers\/:id\/course-access',[^\n]*requirePermission\('manage_subscribers'\)/,
    'collection and customer service both hold manage_subscribers, and only they and the managers do');
});

test('it closes and reopens through the shared entitlement library', () => {
  const handler = read(ROUTE).slice(read(ROUTE).indexOf("router.post('/api/admin/subscribers/:id/course-access'"));
  assert.ok(handler.includes('revokeCourseEntitlement'), 'closing goes through the library');
  assert.ok(handler.includes('grantCourseEntitlement'), 'and opening again through the same one');
  assert.match(handler, /action !== 'close' && action !== 'open'/, 'those are the only two things it does');
  assert.match(handler, /action === 'close' && !reason/, 'a lock has to say what it is for');
});

test('reopening gives back what was taken, not a recomputed smaller number', () => {
  const handler = read(ROUTE).slice(read(ROUTE).indexOf("router.post('/api/admin/subscribers/:id/course-access'"));
  const reopen = handler.slice(handler.indexOf('} else {'), handler.indexOf('entitlement_events already holds'));
  assert.match(reopen, /enrolment\.access_type/, 'the access type it was closed on');
  assert.match(reopen, /enrolment\.lecture_limit/, 'and the lecture count with it');
  assert.match(reopen, /lectureLimit:/,
    'named explicitly — left null, the proportional arithmetic would recompute a smaller share');
});

test('a client outside your scope cannot be touched', () => {
  const handler = read(ROUTE).slice(read(ROUTE).indexOf("router.post('/api/admin/subscribers/:id/course-access'"));
  assert.match(handler, /resolveFinancialScope/, 'the same row-level rule the money screens use');
  assert.match(handler, /financialRecordMatches/, 'checked against this client, not just resolved');
});

test("the client's own record keeps the trail", () => {
  const handler = read(ROUTE).slice(read(ROUTE).indexOf("router.post('/api/admin/subscribers/:id/course-access'"));
  assert.match(handler, /logLeadEvent/,
    'a lock somebody applied by hand is a fact about the customer, not a silent flag');
});

test('the desk can reach it from the client screen', () => {
  const panel = read(PANEL);
  assert.match(panel, /setAccess\(row, 'close'\)/, 'the button that closes');
  assert.match(panel, /setAccess\(row, 'open'\)/, 'and the one that opens it again');
  assert.match(panel, /row\.status !== 'active'/, 'a closed course has to look closed');
  assert.match(panel, /method: 'POST'[\s\S]{0,400}courseId: row\.courseId/,
    'against the route, carrying the course it means');
});
