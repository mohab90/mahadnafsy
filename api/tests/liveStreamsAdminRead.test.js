'use strict';

// The panel's «البث المباشر» lists the streams the institute has saved.
//
// It read them from /api/live-streams — the student's route, which answers 403
// to anyone without a subscriber row and, for those it does answer, drops the
// course-only streams they are not enrolled in. So the admin saved a stream
// and the screen said «البث المباشر (0)»; and because the call runs on every
// page load, every screen logged the 403. The browser test that opens every
// screen found it the first time it ran with a login.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the panel reads its own route, not the student one', () => {
  const api = read('admin/lib/mysqlapi.ts');
  const line = api.split('\n').find(l => l.includes('listLiveStreams:'));
  assert.ok(line, 'listLiveStreams is gone from the admin API client');
  assert.ok(line.includes('`/admin/live-streams?limit='), `the panel still reads: ${line.trim()}`);
});

test('the streams are read by a permission and written by one', () => {
  // Both were requireAdmin when this route was added, which is what the panel
  // needed then. The content permissions reach them now, so whoever keeps the
  // catalogue can list the streams and whoever manages courses can save one —
  // see everyStaffAreaCanBeDelegated.test.js.
  const catalog = read('api/routes/core/catalog.js');
  assert.ok(catalog.includes("router.get('/api/admin/live-streams', requireAuth, requireAdminOrStaff, requirePermission('view_courses'),"));
  assert.ok(catalog.includes("router.post('/api/admin/live-streams', requireAuth, requireAdminOrStaff, requirePermission('manage_courses'),"));
});

test('both routes send a stream in the one shape', () => {
  for (const file of ['api/routes/core/catalog.js', 'api/routes/public.js']) {
    assert.ok(read(file).includes('.map(mapLiveStream)'), `${file} maps streams by hand`);
  }
  const { mapLiveStream } = require('../lib/mappers');
  const stream = mapLiveStream({
    id: 's1', title: 'ليلة المراجعة', instructor_id: null, instructor_name: 'د. منى',
    scheduled_at: '2026-09-20T18:00:00.000Z', duration_minutes: '90', stream_url: 'https://zoom.us/j/1',
    platform: 'ZOOM', visibility: 'COURSE_SUBSCRIBERS', target_course_ids_json: '["c1"]',
    status: 'UPCOMING', recording_url: null, description: null, created_at: '2026-09-01T00:00:00.000Z',
  });
  assert.deepEqual(stream, {
    id: 's1', title: 'ليلة المراجعة', instructorId: undefined, instructorName: 'د. منى',
    scheduledAt: '2026-09-20T18:00:00.000Z', durationMinutes: 90, streamUrl: 'https://zoom.us/j/1',
    platform: 'zoom', visibility: 'course_subscribers', targetCourseIds: ['c1'],
    status: 'upcoming', recordingUrl: undefined, description: undefined, createdAt: '2026-09-01T00:00:00.000Z',
  });
});
