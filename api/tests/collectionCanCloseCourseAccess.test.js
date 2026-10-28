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

// Closing needs a reason, only close and open exist, reopening restores the
// same grant, a desk outside the client's reach is refused and the lock is
// written to the client's record: over HTTP in
// tests/integration/learningAccess.integration.test.js.

test('the route is open to the two desks that use it', () => {
  const source = read(ROUTE);
  assert.match(
    source,
    /router\.post\('\/api\/admin\/subscribers\/:id\/course-access',[^\n]*requirePermission\('manage_subscribers'\)/,
    'collection and customer service both hold manage_subscribers, and only they and the managers do');
});

test('the desk can reach it from the client screen', () => {
  const panel = read(PANEL);
  assert.match(panel, /setAccess\(row, 'close'\)/, 'the button that closes');
  assert.match(panel, /setAccess\(row, 'open'\)/, 'and the one that opens it again');
  assert.match(panel, /row\.status !== 'active'/, 'a closed course has to look closed');
  assert.match(panel, /api\(`\$\{base\}\/course-access`, 'POST', \{ courseId: row\.courseId/,
    'against the route, carrying the course it means');
});
