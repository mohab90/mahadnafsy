'use strict';

// «ترتيب العملاء خليه الاحدث للاقدم بناءا علي تاريخ الاشتراك»: every client list the staff screens read comes newest
// subscription first — a client's latest course subscription, their registration day when they hold none.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin', 'stafflists.js'), 'utf8');

test('the order is the newest subscription, then the registration day, then the id', () => {
  const rule = source.match(/const NEWEST_SUBSCRIPTION = `([^`]+)`/);
  assert.ok(rule, 'the ordering rule is one constant');
  assert.match(rule[1], /MAX\(sub_en\.enrolled_at\)/);
  assert.match(rule[1], /sub_en\.status <> 'removed'/, 'a course taken off a client is not a subscription');
  assert.match(rule[1], /,\s*s\.created_at\)/, 'a client with no course is placed by the day they registered');
});

test('all six client lists use it, and none is left on the registration day alone', () => {
  assert.equal(source.split('ORDER BY ${NEWEST_SUBSCRIPTION} DESC, s.created_at DESC').length - 1, 6);
  // the only plain registration-day order left is the one that locks rows in order for the distribution
  const plain = source.match(/ORDER BY s\.created_at (DESC|ASC)/g) || [];
  assert.deepEqual(plain.filter(text => /DESC/.test(text)).length, 1, 'one more DESC list on registration day: the new-clients feed');
});
