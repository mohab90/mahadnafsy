'use strict';
/**
 * Four screens that accepted input, reported success, and stored nothing — or
 * stored it under a key nothing reads. Run: npm run test:unit
 */
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { saveCourseMaterials, loadCourseMaterials, mapCourse } = require('../lib/mappers');
const { codeOnlyKeepingUrls: codeOnly } = require('./support/repo');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

// A db that records what it was asked to do and answers the reads.
function recordingDb(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      return [sql.includes('SELECT') ? rows : {}];
    },
  };
}

test('course materials are written to the table that has always been there', async () => {
  const db = recordingDb();
  await saveCourseMaterials(db, 'C1', [
    { title: 'ملخص الوحدة الأولى', url: 'https://files/a.pdf', accessLevel: 'full' },
    { title: 'تمارين', url: 'https://files/b.pdf', accessLevel: 'partial' },
    { title: '   ', url: 'https://files/blank.pdf' },
  ]);
  const [remove, insert] = db.calls;
  assert.match(remove.sql, /^DELETE FROM course_materials WHERE course_id=\?$/);
  assert.match(insert.sql, /^INSERT INTO course_materials/);
  assert.equal(insert.params.length, 12, 'the blank title is dropped, two rows survive');
  assert.equal(insert.params[4], 'FULL', 'the column is an ENUM of PARTIAL/FULL');
  assert.equal(insert.params[10], 'PARTIAL');
});

test('and read back in the shape both apps compare against', async () => {
  const db = recordingDb([
    { id: 'M1', course_id: 'C1', title: 'ملخص', url: 'https://files/a.pdf', access_level: 'FULL', sort_order: 0 },
  ]);
  const byCourse = await loadCourseMaterials(db, ['C1', 'C1', null]);
  assert.deepEqual(byCourse.get('C1'), [
    { id: 'M1', title: 'ملخص', url: 'https://files/a.pdf', accessLevel: 'full' },
  ], 'the screens compare accessLevel lowercase');

  // A caller that did not load them must not be handed an empty list, which
  // would read as "this course has no materials".
  assert.equal('materials' in mapCourse({ id: 'C1', title: 'x' }), false);
  assert.deepEqual(mapCourse({ id: 'C1', title: 'x' }, []).materials, []);
});








