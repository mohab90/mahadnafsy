'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { grantCourseEntitlement, grantCourseSelections } = require('../lib/entitlements');

function grantDb(existing = null) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM learning_prerequisites p')) return [[]];
      if (sql.includes('FROM subscribers s JOIN courses')) {
        return [[{ subscriber_id: 'sub-1', course_id: params[0], branch_id: 'branch-1' }]];
      }
      if (sql.includes('SELECT id,status,access_type')) return [[existing]];
      return [{ affectedRows: 1 }];
    },
  };
}

test('course entitlement grant is tenant-owned, audited and idempotent', async () => {
  const db = grantDb(null);
  const first = await grantCourseEntitlement({
    tenantId: 'tenant-a', subscriberId: 'sub-1', courseId: 'course-1',
    accessType: 'limited', lectureLimit: 3, source: 'test', actor: 'qa',
  }, db);
  assert.equal(first.changed, true);
  const insert = db.calls.find(call => call.sql.includes('INSERT INTO enrollments'));
  assert.deepEqual(insert.params.slice(1, 4), ['tenant-a', 'sub-1', 'course-1']);
  assert.ok(db.calls.some(call => call.sql.includes('INSERT INTO entitlement_events')));

  const unchangedDb = grantDb({ id: 'enr-1', status: 'active', access_type: 'full', lecture_limit: null });
  const repeat = await grantCourseEntitlement({
    tenantId: 'tenant-a', subscriberId: 'sub-1', courseId: 'course-1',
    accessType: 'full', source: 'test',
  }, unchangedDb);
  assert.equal(repeat.changed, false);
  assert.ok(!unchangedDb.calls.some(call => call.sql.includes('INSERT INTO entitlement_events')));
});

test('bundle selections expand then grant every tenant course through the same service', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM learning_prerequisites p')) return [[]];
      if (sql.includes('FROM bundle_courses')) return [[
        { bundle_id: 'bundle-1', course_id: 'c1' },
        { bundle_id: 'bundle-1', course_id: 'c2' },
      ]];
      if (sql.includes('FROM subscribers s JOIN courses')) {
        return [[{ subscriber_id: 'sub-1', course_id: params[0], branch_id: 'b1' }]];
      }
      if (sql.includes('SELECT id,status,access_type')) return [[null]];
      return [{ affectedRows: 1 }];
    },
  };
  const result = await grantCourseSelections({
    tenantId: 'tenant-a', subscriberId: 'sub-1',
    selections: [{ courseId: 'bundle:bundle-1', accessType: 'full' }],
  }, db);
  assert.deepEqual(result.courseIds.sort(), ['c1', 'c2']);
  assert.equal(calls.filter(call => call.sql.includes('INSERT INTO enrollments')).length, 2);
});

test('subscriber projection and primary admin flows never use crm_json as course access authority', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const mapper = read('lib/mappers.js');
  const auth = read('routes/auth.js');
  const subscribers = read('routes/admin/subscribers.js');
  assert.doesNotMatch(mapper, /crm\.enrolledCourseIds|crm\.courseAccess/);
  assert.doesNotMatch(auth, /INSERT INTO enrollments|enrolledCourseIds.*crm_json/);
  assert.doesNotMatch(subscribers, /DELETE FROM enrollments|INSERT IGNORE INTO enrollments/);
  assert.match(auth, /grantCourseSelections/);
  assert.match(subscribers, /syncCourseEntitlements/);
});
