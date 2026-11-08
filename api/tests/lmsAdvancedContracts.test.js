'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const { addCohortMember } = require('../lib/learningCohorts');

function cohortDb({ maxStudents = null, memberCount = 0, status = 'active' } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM course_cohorts WHERE')) return [[{
        id: 'cohort-1', course_id: 'course-1', status, max_students: maxStudents,
      }]];
      if (sql.includes('FROM subscribers WHERE')) return [[{ id: 'sub-1', branch_id: 'branch-1' }]];
      if (sql.includes('FROM cohort_members WHERE') && sql.includes('SELECT id,status')) return [[]];
      if (sql.includes('COUNT(*) AS member_count')) return [[{ member_count: memberCount }]];
      if (sql.includes('FROM learning_prerequisites p')) return [[]];
      if (sql.includes('FROM subscribers s JOIN courses c')) return [[{
        subscriber_id: 'sub-1', branch_id: 'branch-1', course_id: 'course-1',
      }]];
      if (sql.includes('SELECT id,status,access_type,lecture_limit FROM enrollments')) return [[]];
      return [{ affectedRows: 1 }];
    },
  };
}



test('cohort enrollment executes membership and entitlement writes through one DB transaction handle', async () => {
  const db = cohortDb();
  const result = await addCohortMember({
    tenantId: 'tenant-1', cohortId: 'cohort-1', subscriberId: 'sub-1', actor: 'staff-1',
  }, db);
  assert.equal(result.changed, true);
  assert.ok(db.calls.some(call => call.sql.includes('INSERT INTO cohort_members')));
  const entitlement = db.calls.find(call => call.sql.includes('INSERT INTO enrollments'));
  assert.ok(entitlement);
  assert.ok(entitlement.params.includes('cohort:cohort-1'));
});

test('cohort capacity rejects before membership or entitlement writes', async () => {
  const db = cohortDb({ maxStudents: 1, memberCount: 1 });
  await assert.rejects(
    addCohortMember({
      tenantId: 'tenant-1', cohortId: 'cohort-1', subscriberId: 'sub-1', actor: 'staff-1',
    }, db),
    /Cohort capacity reached/
  );
  assert.equal(db.calls.some(call => call.sql.includes('INSERT INTO cohort_members')), false);
  assert.equal(db.calls.some(call => call.sql.includes('INSERT INTO enrollments')), false);
});

test('draft cohorts cannot grant course access', async () => {
  const db = cohortDb({ status: 'draft' });
  await assert.rejects(
    addCohortMember({
      tenantId: 'tenant-1', cohortId: 'cohort-1', subscriberId: 'sub-1',
    }, db),
    (error) => error.statusCode === 404
  );
  assert.equal(db.calls.some(call => call.sql.includes('INSERT INTO enrollments')), false);
});










