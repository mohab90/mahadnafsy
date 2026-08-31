'use strict';

const { pool } = require('./db');
const { uuidv4 } = require('./id');
const { notifyWaitlistForFreedSeats } = require('./courseWaitlist');
const { assertLearningPrerequisites } = require('./learningPrerequisites');

// Grants that follow money rather than a person deciding. A recomputation on
// one of these must never take away access the client has already paid for.
const PAYMENT_DRIVEN_SOURCES = new Set([
  'manual_payment', 'payment_proof', 'manual_order_payment',
  'payment_status_review', 'paymob',
]);
function accessPolicy(accessType, lectureLimit) {
  const mode = String(accessType || 'full').toLowerCase() === 'limited' ? 'limited' : 'full';
  const limit = mode === 'limited' ? Math.max(Number(lectureLimit) || 0, 1) : null;
  return { mode, lectureLimit: limit };
}

/**
 * Lectures proportional to what has actually been paid.
 *
 * 'limited' was binary, and its floor is one lecture — so a client who had paid
 * 90% of the price saw exactly as much as one who had paid 6%. Paying in
 * instalments is not the exception here, it is how nearly every client buys:
 * of the eight the reconciliation check flagged, every one had paid between 6%
 * and 29%, and the desk was closing the gap by hand, course by course.
 *
 * Rounds up, so any payment at all opens at least the first lecture and the
 * last instalment is not needed to reach the final one. Returns null when the
 * course has no published lectures to divide, which leaves the previous
 * behaviour — the caller's own floor of one — untouched.
 */
async function proportionalLectureLimit(conn, tenantId, courseId, paidRatio) {
  const ratio = Number(paidRatio);
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  const [[row]] = await conn.query(
    `SELECT COUNT(*) AS n FROM course_lectures
      WHERE course_id=? AND is_published=1`, [courseId]);
  const published = Number(row?.n || 0);
  if (published <= 0) return null;
  return Math.min(published, Math.max(1, Math.ceil(published * ratio)));
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
  /**
   * How much of the price is paid, 0..1, from resolvePaymentAccess. Only used
   * when the grant is limited and no explicit lectureLimit was given, so an
   * admin naming a number still wins over the arithmetic.
   */
  paidRatio = null,
}, db = null) {
  const ownsConnection = !db;
  const conn = db || await pool.getConnection();
  try {
    if (ownsConnection) await conn.beginTransaction();
    await assertLearningPrerequisites({
      tenantId, subscriberId, subjectType: 'course', subjectId: courseId,
    }, conn);
    const subject = await ownedSubject(conn, tenantId, subscriberId, courseId);
    const resolvedLimit = lectureLimit != null
      ? lectureLimit
      : await proportionalLectureLimit(conn, tenantId, courseId, paidRatio);
    const policy = accessPolicy(accessType, resolvedLimit);
    // How long this course is sold for. NULL means unlimited, which is what
    // every course is until someone sets a duration, so nothing changes for
    // existing catalogue entries.
    // Read defensively: granting access must not fail because a duration
    // lookup came back in an unexpected shape. No duration means unlimited,
    // which is the safe direction to be wrong in.
    const durationResult = await conn.query(
      'SELECT access_months FROM courses WHERE id=? AND tenant_id=? LIMIT 1', [courseId, tenantId]);
    const accessMonths = Number(durationResult?.[0]?.[0]?.access_months) || 0;
    const [[existing]] = await conn.query(
      `SELECT id,status,access_type,lecture_limit FROM enrollments
        WHERE tenant_id=? AND subscriber_id=? AND course_id=? LIMIT 1 FOR UPDATE`,
      [tenantId, subscriberId, courseId]
    );
    // A client who has paid in full keeps full access. resolvePaymentAccess
    // answers 'limited' whenever it cannot prove the course is covered — a
    // missing course_expected is enough — and the upsert below writes that
    // straight over an existing grant. So a later bookkeeping row could lock a
    // paid-up client out of lectures they had already been given. 26 of them
    // were locked out that way, which is what reached the desk as
    // "المحاضرات مقفوله".
    //
    // Only payment-driven grants are held back. An admin setting someone to
    // limited is a decision, not a recomputation, and still applies.
    const paymentDriven = PAYMENT_DRIVEN_SOURCES.has(source);
    let effective = paymentDriven && existing?.access_type === 'full' && policy.mode === 'limited'
      ? accessPolicy('full', null)
      : policy;
    // The same rule, one level down: a recomputation may raise a limited grant
    // as instalments come in, and must never lower it. Without this the ratio
    // could shrink a client's access — a later bookkeeping row against a bigger
    // expected total, or a lecture published after they paid, both move the
    // proportion down — and taking back lectures someone has already been
    // given is the exact complaint the full-access guard above exists for.
    //
    // An admin setting a number is still a decision, not a recomputation, so it
    // is left alone.
    if (paymentDriven && effective.mode === 'limited' && existing?.access_type === 'limited') {
      const held = Number(existing.lecture_limit || 0);
      if (held > Number(effective.lectureLimit || 0)) effective = accessPolicy('limited', held);
    }
    const changed = !existing || existing.status !== 'active' ||
      existing.access_type !== effective.mode || Number(existing.lecture_limit || 0) !== Number(effective.lectureLimit || 0);
    const enrollmentId = existing?.id || uuidv4();
    await conn.query(
      `INSERT INTO enrollments
       (id,tenant_id,subscriber_id,course_id,bundle_id,enrolled_at,expiry_date,access_type,lecture_limit,status,
        entitlement_source,granted_by,branch_id)
       VALUES (?,?,?,?,?,COALESCE(?,NOW()),
              CASE WHEN ? > 0 THEN DATE_ADD(COALESCE(?,NOW()), INTERVAL ? MONTH) ELSE NULL END,
              ?,?,'active',?,?,?)
       ON DUPLICATE KEY UPDATE expiry_date=GREATEST(COALESCE(expiry_date,VALUES(expiry_date)),COALESCE(VALUES(expiry_date),expiry_date)),access_type=VALUES(access_type),lecture_limit=VALUES(lecture_limit),
         status='active',entitlement_source=VALUES(entitlement_source),granted_by=VALUES(granted_by),
         bundle_id=COALESCE(VALUES(bundle_id),bundle_id),revoked_at=NULL,revoked_by=NULL,
         branch_id=VALUES(branch_id),updated_at=NOW()`,
      [enrollmentId, tenantId, subscriberId, courseId, bundleId, enrolledAt,
        accessMonths, enrolledAt, accessMonths,
        effective.mode, effective.lectureLimit,
        source, actor, branchId || subject.branch_id || 'branch-other']
    );
    if (changed) {
      await conn.query(
        `INSERT INTO entitlement_events
         (id,tenant_id,enrollment_id,subscriber_id,course_id,event_type,source,actor,meta_json)
         VALUES (?,?,?,?,?,'granted',?,?,?)`,
        [uuidv4(), tenantId, enrollmentId, subscriberId, courseId, source, actor,
          JSON.stringify({ accessType: effective.mode, lectureLimit: effective.lectureLimit, bundleId })]
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
    const explicitLimit = item.videoCount ?? item.lectureLimit ?? null;
    const policy = accessPolicy(item.accessType, explicitLimit);
    const bundleId = id.startsWith('bundle:') ? id.slice(7) : null;
    const ids = bundleId ? (bundleCourses.get(bundleId) || []) : [id];
    // The ratio travels per selection, and only where no explicit limit was
    // named. A bundle spreads it across every course it contains, which is what
    // "half paid" should mean for a diploma: half of each course, not all of
    // the first half of them.
    for (const courseId of ids) {
      expanded.set(courseId, {
        courseId, bundleId, ...policy,
        explicitLimit, paidRatio: item.paidRatio ?? null,
      });
    }
  }
  for (const course of expanded.values()) {
    await grantCourseEntitlement({
      tenantId, subscriberId, courseId: course.courseId, accessType: course.mode,
      lectureLimit: course.explicitLimit == null ? null : course.lectureLimit,
      paidRatio: course.paidRatio,
      branchId, bundleId: course.bundleId, source, actor,
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
