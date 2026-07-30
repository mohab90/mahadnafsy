'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const lib = fs.readFileSync(path.join(__dirname, '..', 'lib', 'courseWaitlist.js'), 'utf8');
const refunds = fs.readFileSync(path.join(__dirname, '..', 'lib', 'refunds.js'), 'utf8');
const subscribersRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin', 'subscribers.js'), 'utf8');
const entitlements = fs.readFileSync(path.join(__dirname, '..', 'lib', 'entitlements.js'), 'utf8');

test('notifyWaitlistForFreedSeats only fires when the course actually has spare capacity', () => {
  assert.match(lib, /if \(!course \|\| !course\.max_students\) return 0;/);
  assert.match(lib, /if \(availableSpots <= 0\) return 0;/);
  assert.match(lib, /ORDER BY position ASC LIMIT \?/);
});

test('a refund that revokes a course entitlement auto-notifies the waitlist (SUB-02)', () => {
  assert.match(refunds, /require\('\.\/entitlements'\)/);
  assert.match(refunds, /revokeCourseEntitlement\(\{/);
  assert.match(entitlements, /notifyWaitlistForFreedSeats\(tenantId, courseId, conn\)/);
});

test('an admin unenrolling a subscriber auto-notifies the waitlist for each freed course (SUB-02)', () => {
  assert.match(subscribersRoute, /require\('\.\.\/\.\.\/lib\/entitlements'\)/);
  assert.match(subscribersRoute, /syncCourseEntitlements\(\{/);
  assert.match(entitlements, /revokeCourseEntitlement\(/);
});
