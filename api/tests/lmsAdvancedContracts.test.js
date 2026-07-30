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

test('cohort membership is tenant-scoped, capacity checked and grants canonical entitlement', () => {
  const service = read('api/lib/learningCohorts.js');
  const migration = read('api/migrations/126_v25_lms_cohorts_instructor_scope.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS course_cohorts/);
  assert.match(migration, /UNIQUE KEY uq_cohort_member \(tenant_id,cohort_id,subscriber_id\)/);
  assert.match(service, /assertLearningPrerequisites\(\{[\s\S]*subjectType: 'cohort'/);
  assert.match(service, /Cohort capacity reached/);
  assert.match(service, /grantCourseEntitlement\(\{/);
  assert.match(service, /source: `cohort:\$\{cohortId\}`/);
});

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

test('cohort removal preserves independent paid or other-cohort access', () => {
  const service = read('api/lib/learningCohorts.js');
  assert.match(service, /has_paid_source/);
  assert.match(service, /has_other_cohort/);
  assert.match(service, /!authority\.has_paid_source && !authority\.has_other_cohort/);
  assert.match(service, /revokeCourseEntitlement\(\{/);
});

test('course analytics are scoped to the assigned instructor identity', () => {
  const adminCatalog = read('api/routes/admin/catalog.js');
  const publicRoutes = read('api/routes/public.js');
  const lmsRoutes = read('api/routes/lms.js');
  assert.match(adminCatalog, /AND instructor_id=\?/);
  assert.match(publicRoutes, /Instructor analytics are limited to assigned courses/);
  assert.match(lmsRoutes, /Instructor analytics are limited to assigned courses/);
  assert.match(publicRoutes, /requirePermission\('view_courses'\)/);
});

test('bundle learning paths carry tenant ownership through catalog and entitlement queries', () => {
  const migration = read('api/migrations/126_v25_lms_cohorts_instructor_scope.sql');
  const catalog = read('api/routes/core/catalog.js');
  const entitlements = read('api/lib/entitlements.js');
  assert.match(migration, /ALTER TABLE bundle_courses[\s\S]*tenant_id/);
  assert.match(catalog, /bundle_courses \(bundle_id, course_id, tenant_id, sort_order\)/);
  assert.match(entitlements, /WHERE bc\.tenant_id=\?/);
});

test('offline progress queue is user-stable, monotonic and refreshes canonical subscriber data', () => {
  const api = read('client/lib/mysqlapi.ts');
  const runtime = read('client/context/site-data-hooks/useClientAccountRuntime.ts');
  const player = read('client/components/UserDashboardVideoPlayer.tsx');
  assert.match(api, /payload\.uid \|\| payload\.email/);
  assert.match(api, /Math\.max\(current\.pct, pct\)/);
  assert.match(api, /error\.status >= 500/);
  assert.match(api, /Math\.max\(current\.watchSeconds \|\| 0, watchSeconds\)/);
  assert.match(api, /window\.addEventListener\('online'/);
  assert.match(runtime, /mahad-progress-synced/);
  assert.match(player, /saveLectureProgress\(lectureId, 100,\s*watchSeconds \?\? getSavedTime\(lectureId\)\)/);
  assert.match(player, /youtube-nocookie\.com/);
  assert.doesNotMatch(player, /lectureProgress:\s*\{/);
  assert.doesNotMatch(player, /notes:\$\{subscriber\.id\}/);
  assert.match(player, /getLectureNote\(selectedId\)/);
  assert.match(player, /saveLectureNote\(lectureId, v\)/);
});

test('unified client course grants use one awaited transactional entitlement sync', () => {
  const coursesTab = read('admin/pages/unified-client/UnifiedClientCoursesTab.tsx');
  const subscribersRoute = read('api/routes/admin/subscribers.js');
  assert.match(coursesTab, /return await updateSubscriber\(\{ \.\.\.subscriber, enrolledCourseIds: courseIds \}\)/);
  assert.match(coursesTab, /const saved = await persistCourses/);
  assert.doesNotMatch(coursesTab, /mysqlAdmin\.addEnrollment|\.catch\(\(\) => \{\}\)/);
  assert.match(subscribersRoute, /await syncCourseEntitlements\([\s\S]{0,600}, conn\)/);
});

test('admin cohort UI is connected to cohort APIs and prerequisite policy', () => {
  const panel = read('admin/pages/dashboard/tabs/courses/CourseCohortsPanel.tsx');
  assert.match(panel, /\/admin\/lms\/cohorts/);
  assert.match(panel, /CoursePrerequisitesPanel subjectType="cohort"/);
  assert.match(panel, /subscriberId/);
});
