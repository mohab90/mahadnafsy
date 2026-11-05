const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadHoldings } = require('../lib/clientView');

// The two mappings this module replaced, kept here as the oracle: the staff lists' batch projection and the single-client profile's inline block.
function oldListProjection(rows) {
  return rows.reduce((projection, row) => {
    const entry = projection[row.subscriber_id] ||= { ids: [], bundleIds: [], access: {} };
    if (row.bundle_id && !entry.bundleIds.includes(String(row.bundle_id))) entry.bundleIds.push(String(row.bundle_id));
    if (!row.course_id) return projection;
    const courseId = String(row.course_id);
    if (!entry.ids.includes(courseId)) entry.ids.push(courseId);
    entry.access[courseId] = row.access_type === 'limited' ? { mode: 'limited', lectureLimit: Number(row.lecture_limit) || 1 } : 'full';
    return projection;
  }, {});
}
function oldProfileBlock(enrollmentRows) {
  const enrolledCourseIds = [...new Set(enrollmentRows.flatMap(enrollment => {
    if (enrollment.course_id) return [String(enrollment.course_id)];
    if (enrollment.bundle_id) return [`bundle:${enrollment.bundle_id}`];
    return [];
  }))];
  const enrolledBundleIds = [...new Set(enrollmentRows.filter(row => row.bundle_id).map(row => String(row.bundle_id)))];
  const courseAccess = Object.fromEntries(enrollmentRows.filter(row => row.course_id).map(row => [
    String(row.course_id),
    row.access_type === 'limited' ? { mode: 'limited', lectureLimit: Number(row.lecture_limit) || 1 } : 'full',
  ]));
  return { enrolledCourseIds, enrolledBundleIds, courseAccess };
}

let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648; const pick = list => list[Math.floor(rnd() * list.length)];
const fakeDb = rows => ({ query: async () => [rows] });

test('it answers exactly what the lists and the profile answered before, over random enrollments', async () => {
  for (let round = 0; round < 200; round++) {
    const rows = Array.from({ length: Math.floor(rnd() * 9) }, () => ({
      subscriber_id: pick(['s1', 's2', 's3']),
      course_id: pick([null, 'c1', 'c2', 'c3', 'c1']),
      bundle_id: pick([null, null, 'b1', 'b2']),
      access_type: pick(['full', 'limited', null]),
      lecture_limit: pick([null, 0, 3]),
    }));
    const holdings = await loadHoldings('t', ['s1', 's2', 's3'], fakeDb(rows));
    const list = oldListProjection(rows);
    for (const id of ['s1', 's2', 's3']) {
      const mine = holdings[id];
      const profile = oldProfileBlock(rows.filter(row => row.subscriber_id === id));
      assert.deepEqual(mine && { ids: mine.ids, bundleIds: mine.bundleIds, access: mine.access }, list[id], `list view of ${id}, round ${round}`);
      assert.deepEqual(mine?.withBundles || [], profile.enrolledCourseIds, `profile courses of ${id}, round ${round}`);
      assert.deepEqual(mine?.bundleIds || [], profile.enrolledBundleIds, `profile tracks of ${id}, round ${round}`);
      assert.deepEqual(mine?.access || {}, profile.courseAccess, `profile access of ${id}, round ${round}`);
    }
  }
});

test('no ids, no query', async () => {
  const db = { query: async () => { throw new Error('queried'); } };
  assert.deepEqual(await loadHoldings('t', [], db), {});
});

test('the lists and the profile read it from here, not from a copy', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.match(read('routes/admin/stafflists.js'), /loadHoldings: loadEnrollmentProjection\b.*lib\/clientView/);
  assert.match(read('routes/admin/subscribers.js'), /loadHoldings\(req\.tenantId, \[r\.id\]\)/);
  assert.doesNotMatch(read('routes/admin/subscribers.js'), /FROM enrollments WHERE tenant_id=\? AND subscriber_id=\? AND status='active'/);
});
