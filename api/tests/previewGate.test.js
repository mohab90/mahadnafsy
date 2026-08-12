'use strict';
// Guards the free-preview gate on the two public lecture routes.
//
// History this locks down: the gate originally numbered lectures by their index
// in the returned array, so page 2 of /api/lectures restarted at 0 and handed
// out a free video per page. The fix replaced that with a positional subquery,
// COUNT(sort_order < …) — which ties. course_lectures.sort_order is
// `NOT NULL DEFAULT 0` with no unique key and routes/lms-admin.js defaults it to
// 0, so a course whose lectures were created without an explicit order had every
// lecture at position 0 and leaked *all* of its paid video URLs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicRoutes = fs.readFileSync(
  path.join(__dirname, '..', 'routes', 'public.js'), 'utf8'
).replace(/\r\n/g, '\n');

test('both public lecture queries rank with ROW_NUMBER, not a tie-prone COUNT', () => {
  const windows = publicRoutes.match(/ROW_NUMBER\(\) OVER \(PARTITION BY \w+\.course_id/g) || [];
  assert.equal(windows.length, 2,
    '/api/courses/:id and /api/lectures must both derive position_in_course from a window function');

  // The tie-prone shape must not come back.
  assert.doesNotMatch(publicRoutes, /COUNT\(\*\)[\s\S]{0,200}sort_order\s*<\s*\w+\.sort_order/,
    'counting "how many sort before me" gives every tied lecture the same position');
});

test('the window breaks ties on a unique column so positions are distinct', () => {
  const orderings = publicRoutes.match(/ORDER BY \w+\.sort_order ASC, \w+\.id ASC\) - 1 AS position_in_course/g) || [];
  assert.equal(orderings.length, 2,
    'ordering by sort_order alone is not deterministic when sort_order repeats');
});

test('unpublished lectures are filtered out of both public routes', () => {
  // /api/courses/:id used to select every lecture regardless of is_published,
  // so drafts were served publicly and also occupied the free positions.
  assert.match(publicRoutes, /WHERE l\.course_id = \? AND l\.is_published = 1/);
  assert.match(publicRoutes, /WHERE cl\.is_published=1 AND c\.tenant_id=\?/);
});

test('the gate still withholds the video URL beyond the preview limit', () => {
  assert.match(publicRoutes,
    /if \(!m\.isPreview && positionInCourse >= previewLimit\) m\.videoUrl = '';/);
});

// ── Behavioural check of the gate itself ────────────────────────────────────
// Mirrors publicLecture() against positions the fixed SQL produces, so the two
// cases that mattered are asserted on behaviour and not only on query text.
const publicLecture = (lecture, positionInCourse, previewLimit) => ({
  id: lecture.id,
  videoUrl: (!lecture.isPreview && positionInCourse >= previewLimit) ? '' : lecture.videoUrl,
});

test('only the first lecture of a course is free, even when sort_order repeats', () => {
  // ROW_NUMBER over (sort_order, id) on four lectures all at sort_order 0.
  const tied = ['a', 'b', 'c', 'd'].map((id, position) => ({
    lecture: { id, isPreview: false, videoUrl: `https://cdn/${id}.mp4` },
    position,
  }));
  const free = tied
    .map(({ lecture, position }) => publicLecture(lecture, position, 1))
    .filter(l => l.videoUrl !== '')
    .map(l => l.id);
  assert.deepEqual(free, ['a']);
});

test('an explicit is_preview lecture stays free wherever it sits', () => {
  const late = publicLecture({ id: 'z', isPreview: true, videoUrl: 'https://cdn/z.mp4' }, 9, 1);
  assert.equal(late.videoUrl, 'https://cdn/z.mp4');
});
