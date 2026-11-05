'use strict';

/**
 * One reading of what a client holds, shared by every route that shows it (clientView, slice 1 — 5 Nov 2026).
 *
 * "What a client holds" is the active enrollments: the courses opened for them (with the kind of access), and the tracks (bundles) they were opened through.
 * The staff lists and the single-client profile each carried their own copy of this mapping; they now read it here, so a change to it is made once.
 * Only this slice is here. The rest of the client's picture (payments, certificates, completions, instalment plans, balances) is still assembled by each route,
 * and moves in later slices one at a time, each compared with the old route's answer before the next.
 */

const { pool } = require('./db');

/**
 * For each subscriber id: { ids, bundleIds, access, withBundles }.
 *   ids         course ids, each once, in row order
 *   bundleIds   track ids, each once, in row order
 *   access      { [courseId]: 'full' | { mode: 'limited', lectureLimit } }
 *   withBundles course ids plus `bundle:<id>` for an enrollment that has a track and no course — what the single-client profile lists as enrolledCourseIds
 * A subscriber with no active enrollment has no entry.
 */
async function loadHoldings(tenantId, subscriberIds, db = pool) {
  if (!subscriberIds.length) return {};
  const [rows] = await db.query(
    `SELECT subscriber_id,course_id,bundle_id,access_type,lecture_limit FROM enrollments
     WHERE tenant_id=? AND status='active' AND subscriber_id IN (${subscriberIds.map(() => '?').join(',')})`,
    [tenantId, ...subscriberIds]
  );
  return rows.reduce((holdings, row) => {
    const entry = holdings[row.subscriber_id] ||= { ids: [], bundleIds: [], access: {}, withBundles: [] };
    // The track a course was opened through: the online screen shows a track booking as the track, not as the courses inside it.
    if (row.bundle_id && !entry.bundleIds.includes(String(row.bundle_id))) entry.bundleIds.push(String(row.bundle_id));
    const held = row.course_id ? String(row.course_id) : row.bundle_id ? `bundle:${row.bundle_id}` : null;
    if (held && !entry.withBundles.includes(held)) entry.withBundles.push(held);
    if (!row.course_id) return holdings;
    const courseId = String(row.course_id);
    if (!entry.ids.includes(courseId)) entry.ids.push(courseId);
    entry.access[courseId] = row.access_type === 'limited'
      ? { mode: 'limited', lectureLimit: Number(row.lecture_limit) || 1 } : 'full';
    return holdings;
  }, {});
}

module.exports = { loadHoldings };
