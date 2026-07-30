'use strict';

const { pool } = require('./db');
const { uuidv4 } = require('./id');
const { grantCourseEntitlement, revokeCourseEntitlement } = require('./entitlements');
const { assertLearningPrerequisites } = require('./learningPrerequisites');

const COHORT_STATUSES = new Set(['draft', 'active', 'completed', 'cancelled']);

async function listCohorts(tenantId, courseId = null, db = pool) {
  const params = [tenantId];
  const courseFilter = courseId ? ' AND ch.course_id=?' : '';
  if (courseId) params.push(courseId);
  const [rows] = await db.query(
    `SELECT ch.id,ch.course_id AS courseId,ch.title,ch.starts_at AS startsAt,
            ch.ends_at AS endsAt,ch.max_students AS maxStudents,ch.status,
            COUNT(CASE WHEN cm.status='active' THEN 1 END) AS memberCount
       FROM course_cohorts ch
       LEFT JOIN cohort_members cm ON cm.cohort_id=ch.id AND cm.tenant_id=ch.tenant_id
      WHERE ch.tenant_id=?${courseFilter}
      GROUP BY ch.id ORDER BY ch.starts_at DESC,ch.created_at DESC`,
    params
  );
  return rows.map(row => ({ ...row, memberCount: Number(row.memberCount) || 0 }));
}

async function saveCohort({
  tenantId, id = null, courseId, title, startsAt = null, endsAt = null,
  maxStudents = null, status = 'draft', actor = null,
}, db) {
  if (!db) throw new Error('saveCohort requires a transaction connection');
  const normalizedStatus = String(status).toLowerCase();
  if (!courseId || !String(title || '').trim() || !COHORT_STATUSES.has(normalizedStatus)) {
    const error = new Error('Valid course, title and cohort status are required'); error.statusCode = 400; throw error;
  }
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    const error = new Error('Cohort end must be after its start'); error.statusCode = 400; throw error;
  }
  const [[course]] = await db.query(
    'SELECT id FROM courses WHERE tenant_id=? AND id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
    [tenantId, courseId]
  );
  if (!course) {
    const error = new Error('Course not found'); error.statusCode = 404; throw error;
  }
  const cohortId = id || uuidv4();
  let previous = null;
  if (id) {
    [[previous]] = await db.query(
      'SELECT id,course_id,status FROM course_cohorts WHERE tenant_id=? AND id=? FOR UPDATE',
      [tenantId, id]
    );
    if (!previous) {
      const error = new Error('Cohort not found'); error.statusCode = 404; throw error;
    }
    if (String(previous.course_id) !== String(courseId)) {
      const [[members]] = await db.query(
        "SELECT COUNT(*) AS count FROM cohort_members WHERE tenant_id=? AND cohort_id=? AND status='active'",
        [tenantId, id]
      );
      if (Number(members?.count) > 0) {
        const error = new Error('Cannot change the course of a cohort with active members');
        error.statusCode = 409;
        throw error;
      }
    }
  }
  await db.query(
    `INSERT INTO course_cohorts
     (id,tenant_id,course_id,title,starts_at,ends_at,max_students,status,created_by)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE course_id=VALUES(course_id),title=VALUES(title),
       starts_at=VALUES(starts_at),ends_at=VALUES(ends_at),max_students=VALUES(max_students),
       status=VALUES(status),updated_at=NOW()`,
    [cohortId, tenantId, courseId, String(title).trim(), startsAt || null, endsAt || null,
      Number(maxStudents) > 0 ? Math.floor(Number(maxStudents)) : null, normalizedStatus, actor]
  );
  if (previous?.status !== 'cancelled' && normalizedStatus === 'cancelled') {
    const [members] = await db.query(
      "SELECT subscriber_id FROM cohort_members WHERE tenant_id=? AND cohort_id=? AND status='active' FOR UPDATE",
      [tenantId, cohortId]
    );
    for (const member of members) {
      await removeCohortMember({
        tenantId, cohortId, subscriberId: member.subscriber_id, actor,
      }, db);
    }
  }
  return cohortId;
}

async function addCohortMember({ tenantId, cohortId, subscriberId, actor = null }, db) {
  if (!db) throw new Error('addCohortMember requires a transaction connection');
  const [[cohort]] = await db.query(
    `SELECT id,course_id,status,max_students
       FROM course_cohorts WHERE tenant_id=? AND id=? FOR UPDATE`,
    [tenantId, cohortId]
  );
  if (!cohort || cohort.status !== 'active') {
    const error = new Error('Active cohort not found'); error.statusCode = 404; throw error;
  }
  const [[subscriber]] = await db.query(
    'SELECT id,branch_id FROM subscribers WHERE tenant_id=? AND id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
    [tenantId, subscriberId]
  );
  if (!subscriber) {
    const error = new Error('Subscriber not found'); error.statusCode = 404; throw error;
  }
  const [[existing]] = await db.query(
    'SELECT id,status FROM cohort_members WHERE tenant_id=? AND cohort_id=? AND subscriber_id=? LIMIT 1 FOR UPDATE',
    [tenantId, cohortId, subscriberId]
  );
  if (existing?.status === 'active') return { changed: false, courseId: cohort.course_id };
  const [[countRow]] = await db.query(
    "SELECT COUNT(*) AS member_count FROM cohort_members WHERE tenant_id=? AND cohort_id=? AND status='active'",
    [tenantId, cohortId]
  );
  if (cohort.max_students && Number(countRow?.member_count) >= Number(cohort.max_students)) {
    const error = new Error('Cohort capacity reached'); error.statusCode = 409; throw error;
  }
  await assertLearningPrerequisites({
    tenantId, subscriberId, subjectType: 'cohort', subjectId: cohortId,
  }, db);
  await db.query(
    `INSERT INTO cohort_members
     (id,tenant_id,cohort_id,subscriber_id,status,enrolled_at,removed_at,created_by)
     VALUES (?,?,?,?,'active',NOW(),NULL,?)
     ON DUPLICATE KEY UPDATE status='active',enrolled_at=NOW(),removed_at=NULL,updated_at=NOW()`,
    [existing?.id || uuidv4(), tenantId, cohortId, subscriberId, actor]
  );
  await grantCourseEntitlement({
    tenantId, subscriberId, courseId: cohort.course_id, branchId: subscriber.branch_id,
    source: `cohort:${cohortId}`, actor,
  }, db);
  return { changed: true, courseId: cohort.course_id };
}

async function removeCohortMember({ tenantId, cohortId, subscriberId, actor = null }, db) {
  if (!db) throw new Error('removeCohortMember requires a transaction connection');
  const [[cohort]] = await db.query(
    'SELECT id,course_id FROM course_cohorts WHERE tenant_id=? AND id=? FOR UPDATE',
    [tenantId, cohortId]
  );
  if (!cohort) {
    const error = new Error('Cohort not found'); error.statusCode = 404; throw error;
  }
  const [removed] = await db.query(
    `UPDATE cohort_members SET status='removed',removed_at=NOW(),updated_at=NOW()
      WHERE tenant_id=? AND cohort_id=? AND subscriber_id=? AND status='active'`,
    [tenantId, cohortId, subscriberId]
  );
  if (!removed.affectedRows) return { changed: false };
  const [[authority]] = await db.query(
    `SELECT e.id,e.entitlement_source,
            EXISTS(SELECT 1 FROM payments p
              WHERE p.tenant_id=? AND p.subscriber_id=? AND p.status='paid' AND p.deleted_at IS NULL
                AND (p.course_id=? OR EXISTS(
                  SELECT 1 FROM bundle_courses bc
                  WHERE bc.tenant_id=p.tenant_id AND bc.bundle_id=p.bundle_id AND bc.course_id=?
                ))) AS has_paid_source,
            EXISTS(SELECT 1 FROM cohort_members cm
              JOIN course_cohorts other_ch ON other_ch.id=cm.cohort_id AND other_ch.tenant_id=cm.tenant_id
              WHERE cm.tenant_id=? AND cm.subscriber_id=? AND cm.status='active'
                AND other_ch.course_id=?) AS has_other_cohort
       FROM enrollments e
      WHERE e.tenant_id=? AND e.subscriber_id=? AND e.course_id=? AND e.status='active'
      LIMIT 1 FOR UPDATE`,
    [tenantId, subscriberId, cohort.course_id, cohort.course_id,
      tenantId, subscriberId, cohort.course_id,
      tenantId, subscriberId, cohort.course_id]
  );
  if (authority?.entitlement_source === `cohort:${cohortId}` && !authority.has_paid_source && !authority.has_other_cohort) {
    await revokeCourseEntitlement({
      tenantId, subscriberId, courseId: cohort.course_id,
      source: `cohort:${cohortId}`, actor, reason: 'cohort_membership_removed',
    }, db);
  }
  return { changed: true };
}

async function listCohortMembers(tenantId, cohortId, db = pool) {
  const [rows] = await db.query(
    `SELECT cm.id,cm.subscriber_id AS subscriberId,s.name,s.email,s.phone,
            cm.status,cm.enrolled_at AS enrolledAt,cm.removed_at AS removedAt
       FROM cohort_members cm
       JOIN course_cohorts ch ON ch.id=cm.cohort_id AND ch.tenant_id=cm.tenant_id
       JOIN subscribers s ON s.id=cm.subscriber_id AND s.tenant_id=cm.tenant_id
      WHERE cm.tenant_id=? AND cm.cohort_id=? ORDER BY cm.enrolled_at DESC`,
    [tenantId, cohortId]
  );
  return rows;
}

module.exports = {
  addCohortMember,
  listCohortMembers,
  listCohorts,
  removeCohortMember,
  saveCohort,
};
