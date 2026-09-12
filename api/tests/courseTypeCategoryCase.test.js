'use strict';

// courses.type and courses.category are ENUMs whose members are upper case, and
// MySQL stores the *declared* spelling — so the admin form sends 'Mix' and the
// row comes back 'MIX'. Both apps declare the mixed-case vocabulary in their own
// types and compare it with ===, which is case-sensitive.
//
// Live on the site until this: picking any type or any category on /courses
// emptied the page, and every course card read «مسجل» — including all twenty
// 'MIX' courses.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mapCourse } = require('../lib/mappers');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map(line => line.replace(/(^|\s)\/\/[^\n]*/, '$1'))
  .join('\n');

test('a course arrives spelled the way both apps declare it', () => {
  // The spellings production actually returns.
  assert.equal(mapCourse({ id: 'c1', type: 'MIX', category: 'GENERAL' }).type, 'Mix');
  assert.equal(mapCourse({ id: 'c1', type: 'RECORDED', category: 'THERAPY' }).category, 'Therapy');
  assert.equal(mapCourse({ id: 'c1', type: 'RECORDED' }).type, 'Recorded');
  assert.equal(mapCourse({ id: 'c1', category: 'CHILD' }).category, 'Child');
  assert.equal(mapCourse({ id: 'c1', category: 'DIAGNOSIS' }).category, 'Diagnosis');
  // Already-canonical values pass through unchanged.
  assert.equal(mapCourse({ id: 'c1', type: 'Live' }).type, 'Live');
  // Anything unrecognised lands on the same defaults the write path uses,
  // rather than reaching a screen as a value no filter can match.
  assert.equal(mapCourse({ id: 'c1', type: '', category: null }).type, 'Recorded');
  assert.equal(mapCourse({ id: 'c1', type: 'nonsense' }).category, 'General');
});

test('the spellings the mapper emits are the ones the screens compare', () => {
  // Both apps declare the vocabulary in their own types; the filters and the
  // card labels compare against it directly.
  for (const rel of ['client/types.ts', 'admin/types.ts']) {
    const types = read(rel);
    assert.match(types, /type: 'Recorded' \| 'Live' \| 'Mix';/, `${rel} declares a different course type`);
    assert.match(types, /category: 'Therapy' \| 'Diagnosis' \| 'Child' \| 'General';/);
  }
  const courses = codeOnly(read('client/pages/Courses.tsx'));
  for (const value of ['Recorded', 'Live', 'Mix', 'Therapy', 'Child', 'Diagnosis']) {
    assert.match(courses, new RegExp(`value="${value}"`), `the filter no longer offers ${value}`);
  }
  // 'General' is the write path's default and the largest group on the site,
  // and it was the one category with no way to filter to it.
  assert.match(courses, /value="General"/);
  assert.match(codeOnly(read('api/routes/admin/catalog.js')), /c\.category \|\| 'GENERAL'/);
});

test('the card label follows the same spelling', () => {
  const card = codeOnly(read('client/components/CourseCard.tsx'));
  assert.match(card, /course\.type === 'Mix'/);
  assert.match(card, /course\.type === 'Live'/);
});
