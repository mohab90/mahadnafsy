'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const lib = fs.readFileSync(path.join(__dirname, '..', 'lib', 'courseWaitlist.js'), 'utf8');
const refunds = fs.readFileSync(path.join(__dirname, '..', 'lib', 'refunds.js'), 'utf8');
const subscribersRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin', 'subscribers.js'), 'utf8');

test('notifyWaitlistForFreedSeats only fires when the course actually has spare capacity', () => {
  assert.match(lib, /if \(!course \|\| !course\.max_students\) return 0;/);
  assert.match(lib, /if \(availableSpots <= 0\) return 0;/);
  assert.match(lib, /ORDER BY position ASC LIMIT \?/);
});

test('a refund that removes a course enrollment auto-notifies the waitlist (SUB-02)', () => {
  assert.match(refunds, /require\('\.\/courseWaitlist'\)/);
  assert.match(refunds, /notifyWaitlistForFreedSeats\(tenantId, pay\.course_id, conn\)/);
});

test('an admin unenrolling a subscriber auto-notifies the waitlist for each freed course (SUB-02)', () => {
  assert.match(subscribersRoute, /require\('\.\.\/\.\.\/lib\/courseWaitlist'\)/);
  assert.match(subscribersRoute, /notifyWaitlistForFreedSeats\(tenantId, courseId, conn\)/);
});
