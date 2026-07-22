'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('course completion requires a paid enrollment inside the same tenant', () => {
  const service = read('lib/courseCompletion.js');
  assert.match(service, /JOIN enrollments e ON e\.subscriber_id=s\.id AND e\.tenant_id=s\.tenant_id/);
  assert.match(service, /JOIN courses c ON c\.id=e\.course_id AND c\.tenant_id=e\.tenant_id/);
  assert.match(service, /p\.tenant_id=s\.tenant_id AND p\.subscriber_id=s\.id AND p\.status='paid'/);
  assert.match(service, /LIMIT 1 FOR UPDATE/);
});

test('certificate persistence and notification outbox share one transaction', () => {
  const service = read('lib/courseCompletion.js');
  assert.match(service, /await conn\.beginTransaction\(\)/);
  assert.match(service, /INSERT INTO course_completions[^\n]+tenant_id/);
  assert.match(service, /outbox\.enqueue\([\s\S]*course-completion:\$\{tenantId\}/);
  assert.match(service, /await conn\.commit\(\)/);
  assert.match(service, /await conn\.rollback\(\)/);
  assert.match(service, /escapeHtml\(eligibility\.name\)/);
});

test('bulk completion is bounded and all-or-nothing', () => {
  const service = read('lib/courseCompletion.js');
  assert.match(service, /ids\.length > 500/);
  assert.match(service, /await conn\.beginTransaction\(\)[\s\S]*for \(const subscriberId of ids\)[\s\S]*await conn\.commit\(\)/);
  assert.match(service, /catch \(error\)[\s\S]*await conn\.rollback\(\)/);
});

test('admin completion routes use the central service and permission checks', () => {
  const route = read('routes/lms.js');
  assert.match(route, /router\.post\('\/api\/admin\/completions'[^\n]+requirePermission\('manage_courses'\)/);
  assert.match(route, /completeCourse\(\{[\s\S]*tenantId: req\.tenantId/);
  assert.match(route, /completeCourses\(\{[\s\S]*tenantId: req\.tenantId/);
  assert.doesNotMatch(route, /legacy implementation retained for rollback visibility/);
  assert.match(route, /WHERE cc\.tenant_id=\?/);
});

test('live sessions and waitlists are tenant owned and notify through the outbox', () => {
  const route = read('routes/lms.js');
  const migration = read('migrations/083_v25_lms_sequence_tenant_scope.sql');
  assert.match(migration, /ALTER TABLE live_sessions[\s\S]*tenant_id/);
  assert.match(migration, /ALTER TABLE course_waitlist[\s\S]*tenant_id/);
  assert.match(route, /INSERT INTO live_sessions \(id, tenant_id/);
  assert.match(route, /WHERE id=\? AND tenant_id=\?/);
  assert.match(route, /INSERT INTO course_waitlist \(id, tenant_id/);
  assert.match(route, /course_waitlist SET status[\s\S]*tenant_id=\?/);
  assert.match(route, /dedupeKey: `live-session:\$\{req\.tenantId\}/);
  assert.match(route, /dedupeKey: `waitlist-seat:\$\{req\.tenantId\}/);
});

test('email sequences are tenant scoped and scheduled in the durable outbox', () => {
  const service = read('lib/emailSequence.js');
  const route = read('routes/lms.js');
  assert.match(service, /WHERE seq\.tenant_id=\? AND seq\.trigger_event=\?/);
  assert.match(service, /outbox\.enqueue\([\s\S]*dedupeKey: `email-sequence:\$\{tenantId\}/);
  assert.match(service, /promoteLegacyEmailSequenceQueue/);
  assert.match(route, /email_sequences WHERE tenant_id=\?/);
  assert.doesNotMatch(route, /Scheduler: every 5 minutes/);
});

test('legacy HR routes inside the LMS router use tenant-scoped writes', () => {
  const route = read('routes/lms.js');
  assert.match(route, /INSERT INTO work_schedules \(id, tenant_id/);
  assert.match(route, /WHERE al\.tenant_id=\?/);
  assert.match(route, /INSERT INTO attendance_logs \(id, tenant_id/);
  assert.match(route, /INSERT INTO performance_appraisals \(id, tenant_id/);
  assert.match(route, /performance_appraisals SET[^\n]+WHERE id = \? AND tenant_id=\?/);
});
