'use strict';

// A course placed in another branch than its client's.
//
// «لو العميل بيحضر كورس اونلاين وكورس حضور محتاجين نقدر نقسم العميل بين الفروع … تحويل جزئي لكورس معين»
// (15 Oct 2026). The client keeps one file and one own branch; a course or track can be placed elsewhere.
// A branch lists the clients it owns AND the ones with a course placed in it, and shows each only the
// courses that are its own: the placed ones in the branch they were placed in, the rest in the client's.

const { VALID_BRANCHES } = require('../constants/permissions');

const cleanItem = value => String(value || '').trim().slice(0, 80);
const cleanBranch = value => String(value || '').trim().toUpperCase().replace(/[-\s]/g, '_');

/** Subscriber id → { item: branch } for the ids given. */
async function loadPlacements(db, tenantId, ids) {
  const map = new Map();
  if (!ids.length) return map;
  const [rows] = await db.query(
    `SELECT subscriber_id, item_key, branch FROM subscriber_course_branches WHERE tenant_id = ? AND subscriber_id IN (${ids.map(() => '?').join(',')})`,
    [tenantId, ...ids]);
  for (const row of rows) {
    if (!map.has(row.subscriber_id)) map.set(row.subscriber_id, {});
    map.get(row.subscriber_id)[row.item_key] = row.branch;
  }
  return map;
}

/**
 * Places a course in a branch, or — with no branch — puts it back in its client's own.
 * Returns { item, branch } as stored (branch null when removed), or throws a 400.
 */
async function placeCourse(db, { tenantId, subscriberId, item, branch, actor }) {
  const key = cleanItem(item);
  if (!key) throw Object.assign(new Error('اختار الكورس'), { statusCode: 400 });
  const target = branch ? cleanBranch(branch) : '';
  if (target && !VALID_BRANCHES.has(target)) throw Object.assign(new Error('الفرع غير معروف'), { statusCode: 400 });
  if (!target) {
    await db.query('DELETE FROM subscriber_course_branches WHERE tenant_id=? AND subscriber_id=? AND item_key=?', [tenantId, subscriberId, key]);
    return { item: key, branch: null };
  }
  await db.query(
    `INSERT INTO subscriber_course_branches (tenant_id, subscriber_id, item_key, branch, placed_by) VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE branch = VALUES(branch), placed_by = VALUES(placed_by), placed_at = CURRENT_TIMESTAMP`,
    [tenantId, subscriberId, key, target, String(actor || '').slice(0, 120) || null]);
  return { item: key, branch: target };
}

/**
 * SQL for «the client is this branch's»: its own branch, or a course placed there. `branches` is bound twice.
 * (The one clause every client list's scope uses, so a placed client reaches the branch that holds a course.)
 */
const ownOrPlaced = (branches, alias = 's') => {
  const marks = branches.map(() => '?').join(',');
  return `(${alias}.branch IN (${marks}) OR EXISTS (SELECT 1 FROM subscriber_course_branches pb
            WHERE pb.tenant_id = ${alias}.tenant_id AND pb.subscriber_id = ${alias}.id AND pb.branch IN (${marks})))`;
};

module.exports = { loadPlacements, placeCourse, ownOrPlaced, cleanBranch };
