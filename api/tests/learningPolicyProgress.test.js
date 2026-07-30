'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertLearningPrerequisites } = require('../lib/learningPrerequisites');
const { recordLectureProgress } = require('../lib/learningProgress');

test('learning prerequisite policy rejects a missing completion and accepts server facts', async () => {
  const rules = [{ prerequisite_course_id: 'pre-1', requirement_type: 'completion', title: 'التمهيدي' }];
  const missingDb = {
    async query(sql) {
      if (sql.includes('JOIN courses')) return [rules];
      return [[{ prerequisite_course_id: 'pre-1', has_entitlement: 1, has_completion: 0 }]];
    },
  };
  await assert.rejects(
    () => assertLearningPrerequisites({
      tenantId: 'tenant-a', subscriberId: 'sub-1', subjectType: 'course', subjectId: 'advanced',
    }, missingDb),
    /التمهيدي/
  );

  const satisfiedDb = {
    async query(sql) {
      if (sql.includes('JOIN courses')) return [rules];
      return [[{ prerequisite_course_id: 'pre-1', has_entitlement: 1, has_completion: 1 }]];
    },
  };
  assert.equal(await assertLearningPrerequisites({
    tenantId: 'tenant-a', subscriberId: 'sub-1', subjectType: 'course', subjectId: 'advanced',
  }, satisfiedDb), true);
});

test('lecture progress accepts only active entitlement and never moves progress backwards', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM course_lectures cl') && sql.includes('LEFT JOIN enrollments')) {
        return [[{
          id: 'lec-1', course_id: 'course-1', access_type: 'full',
          enrolled_at: '2026-01-01', sort_order: 1, chapter_sort: 1,
        }]];
      }
      if (sql.includes('SELECT progress_pct')) return [[{ progress_pct: 80, completed_at: null }]];
      return [{ affectedRows: 1 }];
    },
  };
  const result = await recordLectureProgress({
    tenantId: 'tenant-a', subscriberId: 'sub-1', lectureId: 'lec-1', progress: 20,
  }, db);
  assert.equal(result.progress, 80);
  const upsert = calls.find(call => call.sql.includes('INSERT INTO lecture_completions'));
  assert.match(upsert.sql, /GREATEST\(progress_pct,VALUES\(progress_pct\)\)/);
  assert.match(calls[0].sql, /e\.status='active'/);
  assert.deepEqual(calls[0].params, ['tenant-a', 'sub-1', 'tenant-a', 'lec-1']);
});

test('lecture progress rejects limited and drip-locked lectures', async () => {
  const limitedDb = {
    async query(sql) {
      if (sql.includes('LEFT JOIN enrollments')) return [[{
        id: 'lec-5', course_id: 'course-1', access_type: 'limited', lecture_limit: 2,
        enrolled_at: '2026-01-01', sort_order: 5, chapter_sort: 5,
      }]];
      return [[{ pos: 4 }]];
    },
  };
  await assert.rejects(() => recordLectureProgress({
    tenantId: 'tenant-a', subscriberId: 'sub-1', lectureId: 'lec-5', progress: 100,
  }, limitedDb), /access_limited/);

  const dripDb = {
    async query() {
      return [[{
        id: 'lec-1', course_id: 'course-1', access_type: 'full',
        enrolled_at: new Date().toISOString(), drip_unlock_days: 7,
      }]];
    },
  };
  await assert.rejects(() => recordLectureProgress({
    tenantId: 'tenant-a', subscriberId: 'sub-1', lectureId: 'lec-1', progress: 100,
  }, dripDb), /drip_locked/);
});

test('lecture completion cannot jump to 100 with zero watch time when duration is known', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('LEFT JOIN enrollments')) {
        return [[{
          id: 'lec-1', course_id: 'course-1', access_type: 'full',
          enrolled_at: '2026-01-01', duration_seconds: 600,
        }]];
      }
      if (sql.includes('SELECT progress_pct')) {
        return [[{ progress_pct: 0, watch_seconds: 0, completed_at: null }]];
      }
      return [{ affectedRows: 1 }];
    },
  };
  const result = await recordLectureProgress({
    tenantId: 'tenant-a', subscriberId: 'sub-1', lectureId: 'lec-1',
    progress: 100, watchSeconds: 0,
  }, db);
  assert.equal(result.progress, 0);
  const insert = calls.find(call => call.sql.includes('INSERT INTO lecture_completions'));
  assert.equal(insert.params[3], 0);
});
