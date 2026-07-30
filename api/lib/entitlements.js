'use strict';

const { pool } = require('./db');
const { uuidv4 } = require('./id');
const { notifyWaitlistForFreedSeats } = require('./courseWaitlist');
const { assertLearningPrerequisites } = require('./learningPrerequisites');

function accessPolicy(accessType, lectureLimit) {
  const mode = String(accessType || 'full').toLowerCase() === 'limited' ? 'limited' : 'full';
  const limit = mode === 'limited' ? Math.max(Number(lectureLimit) || 0, 1) : null;
  return { mode, lectureLimit: limit };
}

async function ownedSubject(conn, tenantId, subscriberId, courseId) {
  const [[row]] = await conn.query(
    `SELECT s.id AS subscriber_id,s.branch_id,c.id AS course_id
       FROM subscribers s JOIN courses c ON c.id=? AND c.tenant_id=s.tenant_id AND c.deleted_at IS NULL
      WHERE s.id=? AND s.tenant_id=? LIMIT 1 FOR UPDATE`,
    [courseId, subscriberId, tenantId]
  );
  if (!row) {
    const error = new Error('Tenant subscriber/course entitlement subject not found');
    error.statusCode = 404;
    throw error;
  }
  return row;
}

async function grantCourseEntitlement({
  tenantId, subscriberId, courseId, accessType = 'full', lectureLimit = null,
  branchId = null, bundleId = null, enrolledAt = null, source = 'admin', actor = null,
}, db = null) {
  const ownsConnection = !db;
  const conn = db || await pool.getConnection();
  try {
    if (ownsConnection) await conn.beginTransaction();
    await assertLearningPrerequisites({
      tenantId, subscriberId, subjectType: 'course', subjectId: courseId,
    }, conn);
    const subject = await ownedSubject(conn, tenantId, subscriberId, courseId);
    const policy = accessPolicy(accessType, lectureLimit);
    const [[existing]] = await conn.query(
      `SELECT id,status,access_type,lecture_limit FROM enrollments
        WHERE tenant_id=? AND subscriber_id=? AND course_id=? LIMIT 1 FOR UPDATE`,
      [tenantId, subscriberId, courseId]
    );
    const changed = !existing || existing.status !== 'active' ||
      existing.access_type !== policy.mode || Number(existing.lecture_limit || 0) !== Number(policy.lectureLimit || 0);
    const enrollmentId = existing?.id || uuidv4();
    await conn.query(
      `INSERT INTO enrollments
       (id,tenant_id,subscriber_id,course_id,bundle_id,enrolled_at,access_type,lecture_limit,status,
        entitlement_source,granted_by,branch_id)
       VALUES (?,?,?,?,?,COALESCE(?,NOW()),?,?,'active',?,?,?)
       ON DUPLICATE KEY UPDATE access_type=VALUES(access_type),lecture_limit=VALUES(lecture_limit),
         status='active',entitlement_source=VALUES(entitlement_source),granted_by=VALUES(granted_by),
         bundle_id=COALESCE(VALUES(bundle_id),bundle_id),revoked_at=NULL,revoked_by=NULL,
         branch_id=VALUES(branch_id),updated_at=NOW()`,
      [enrollmentId, tenantId, subscriberId, courseId, bundleId, enrolledAt, policy.mode, policy.lectureLimit,
        source, actor, branchId || subject.branch_id || 'branch-other']
    );
    if (changed) {
      await conn.query(
        `INSERT INTO entitlement_events
         (id,tenant_id,enrollment_id,subscriber_id,course_id,event_type,source,actor,meta_json)
         VALUES (?,?,?,?,?,'granted',?,?,?)`,
        [uuidv4(), tenantId, enrollmentId, subscriberId, courseId, source, actor,
          JSON.stringify({ accessType: policy.mode, lectureLimit: policy.lectureLimit, bundleId })]
      );
    }
    if (ownsConnection) await conn.commit();
    return { id: enrollmentId, changed, ...policy };
  } catch (error) {
    if (ownsConnection) await conn.rollback().catch(() => {});
    throw error;
  } finally {
    if (ownsConnection) conn.release();
  }
}

async function revokeCourseEntitlement({
  tenantId, subscriberId, courseId, source = 'admin', actor = null, reason = null,
}, db = null) {
  const ownsConnection = !db;
  const conn = db || await pool.getConnection();
  try {
    if (ownsConnection) await conn.beginTransaction();
    const [[enrollment]] = await conn.query(
      `SELECT id,status FROM enrollments
        WHERE tenant_id=? AND subscriber_id=? AND course_id=? LIMIT 1 FOR UPDATE`,
      [tenantId, subscriberId, courseId]
    );
    if (!enrollment || enrollment.status !== 'active') {
      if (ownsConnection) await conn.commit();
      return { changed: false };
    }
    await conn.query(
      `UPDATE enrollments SET status='revoked',revoked_at=NOW(),revoked_by=?,updated_at=NOW()
        WHERE id=? AND tenant_id=?`,
      [actor, enrollment.id, tenantId]
    );
    await conn.query(
      `INSERT INTO entitlement_events
       (id,tenant_id,enrollment_id,subscriber_id,course_id,event_type,source,actor,meta_json)
       VALUES (?,?,?,?,?,'revoked',?,?,?)`,
      [uuidv4(), tenantId, enrollment.id, subscriberId, courseId, source, actor, JSON.stringify({ reason })]
    );
    await notifyWaitlistForFreedSeats(tenantId, courseId, conn).catch(() => {});
    if (ownsConnection) await conn.commit();
    return { changed: true, id: enrollment.id };
  } catch (error) {
    if (ownsConnection) await conn.rollback().catch(() => {});
    throw error;
  } finally {
    if (ownsConnection) conn.release();
  }
}

async function syncCourseEntitlements({
  tenantId, subscriberId, courses, branchId = null, source = 'admin', actor = null,
}, db) {
  if (!db) throw new Error('syncCourseEntitlements requires a transaction connection');
  const desired = new Map((courses || []).map(course => {
    const courseId = String(course.courseId || course.id || '');
    return [courseId, { courseId, ...accessPolicy(course.accessType, course.lectureLimit) }];
  }).filter(([courseId]) => courseId));
  const [existing] = await db.query(
    `SELECT course_id FROM enrollments
      WHERE tenant_id=? AND subscriber_id=? AND status='active' AND course_id IS NOT NULL FOR UPDATE`,
    [tenantId, subscriberId]
  );
  for (const row of existing) {
    if (!desired.has(String(row.course_id))) {
      await revokeCourseEntitlement({ tenantId, subscriberId, courseId: row.course_id, source, actor }, db);
    }
  }
  for (const course of desired.values()) {
    await grantCourseEntitlement({
      tenantId, subscriberId, courseId: course.courseId, accessType: course.mode,
      lectureLimit: course.lectureLimit, branchId, source, actor,
    }, db);
  }
  return { active: desired.size };
}

async function grantCourseSelections({
  tenantId, subscriberId, selections, branchId = null, source = 'admin', actor = null,
}, db) {
  if (!db) throw new Error('grantCourseSelections requires a transaction connection');
  const selected = (selections || []).filter(item => String(item.courseId || '').trim());
  const bundleIds = [...new Set(selected
    .map(item => String(item.courseId).trim())
    .filter(id => id.startsWith('bundle:'))
    .map(id => id.slice(7)))];
  const bundleCourses = new Map();
  if (bundleIds.length) {
    const [rows] = await db.query(
      `SELECT bc.bundle_id,bc.course_id FROM bundle_courses bc
       JOIN bundles b ON b.id=bc.bundle_id AND b.tenant_id=bc.tenant_id
       JOIN courses c ON c.id=bc.course_id AND c.tenant_id=bc.tenant_id AND c.deleted_at IS NULL
       WHERE bc.tenant_id=? AND bc.bundle_id IN (${bundleIds.map(() => '?').join(',')})`,
      [tenantId, ...bundleIds]
    );
    for (const row of rows) {
      const list = bundleCourses.get(row.bundle_id) || [];
      list.push(row.course_id);
      bundleCourses.set(row.bundle_id, list);
    }
  }
  const expanded = new Map();
  for (const item of selected) {
    const id = String(item.courseId).trim();
    if (id.startsWith('bundle:')) {
      await assertLearningPrerequisites({
        tenantId, subscriberId, subjectType: 'bundle', subjectId: id.slice(7),
      }, db);
    }
    const policy = accessPolicy(item.accessType, item.videoCount ?? item.lectureLimit);
    const bundleId = id.startsWith('bundle:') ? id.slice(7) : null;
    const ids = bundleId ? (bundleCourses.get(bundleId) || []) : [id];
    for (const courseId of ids) expanded.set(courseId, { courseId, bundleId, ...policy });
  }
  for (const course of expanded.values()) {
    await grantCourseEntitlement({
      tenantId, subscriberId, courseId: course.courseId, accessType: course.mode,
      lectureLimit: course.lectureLimit, branchId, bundleId: course.bundleId, source, actor,
    }, db);
  }
  return { granted: expanded.size, courseIds: [...expanded.keys()] };
}

module.exports = {
  accessPolicy,
  grantCourseEntitlement,
  grantCourseSelections,
  revokeCourseEntitlement,
  syncCourseEntitlements,
};
