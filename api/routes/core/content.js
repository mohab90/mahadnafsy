'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../../lib/logger');
const { pool } = require('../../lib/db');
const { grantCourseSelections } = require('../../lib/entitlements');
const { DEFAULT_TENANT_ID } = require('../../lib/tenantScope');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');

// The only non-duplicate responsibility retained from the old content router.
// Manual enrollment is tenant-scoped and atomic; payment-driven enrollment is
// handled by the payment workflow instead.
// GET + PUT /api/admin/subscribers/:id/course-access — how long this one
// customer keeps each of their courses.
//
// The course sets the default length; this is where it is overridden for a
// person: extend someone who asked for more time, shorten one who should not
// still have it, or clear the date to make their copy permanent. Without it
// the duration would be a policy with no exceptions, which is not how the
// institute actually works.
router.get('/api/admin/subscribers/:id/course-access', requireAuth, requireAdminOrStaff, requirePermission('view_subscribers'), async (req, res) => {
  try {
    const tenantId = req.tenantId || DEFAULT_TENANT_ID;
    const [rows] = await pool.query(
      `SELECT e.id, e.course_id, e.enrolled_at, e.expiry_date, e.access_type, e.status,
              e.lecture_limit,
              (SELECT COUNT(*) FROM course_lectures cl
                WHERE cl.course_id = e.course_id AND cl.is_published = 1) AS lecture_count,
              (SELECT COALESCE(SUM(cl.duration_seconds), 0) FROM course_lectures cl
                WHERE cl.course_id = e.course_id AND cl.is_published = 1) AS total_seconds,
              (SELECT COUNT(*) FROM lecture_completions lp
                WHERE lp.subscriber_id = e.subscriber_id AND lp.course_id = e.course_id
                  AND (lp.progress_pct >= 90 OR lp.completed_at IS NOT NULL)) AS watched_count,
              (SELECT COALESCE(SUM(p.amount_egp), 0) FROM payments p
                WHERE p.subscriber_id = e.subscriber_id AND p.tenant_id = e.tenant_id
                  AND p.course_id = e.course_id AND p.status = 'paid'
                  AND p.deleted_at IS NULL) AS paid_egp,
              (SELECT MAX(p.course_expected) FROM payments p
                WHERE p.subscriber_id = e.subscriber_id AND p.tenant_id = e.tenant_id
                  AND p.course_id = e.course_id AND p.deleted_at IS NULL) AS expected_egp,
              c.price_egp,
              c.title, c.title_ar, c.access_months
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id AND c.tenant_id = e.tenant_id
        WHERE e.subscriber_id = ? AND e.tenant_id = ? AND c.deleted_at IS NULL
        ORDER BY e.enrolled_at DESC`,
      [req.params.id, tenantId]);
    res.json(rows.map(r => ({
      enrollmentId: r.id,
      courseId: r.course_id,
      title: r.title_ar || r.title,
      enrolledAt: r.enrolled_at,
      expiresAt: r.expiry_date,
      courseDefaultMonths: r.access_months,
      accessType: r.access_type,
      // Expected falls back to the catalogue price when no payment recorded
      // one — a course someone was enrolled in manually still has a value.
      paidEgp: Number(r.paid_egp) || 0,
      expectedEgp: Number(r.expected_egp) || Number(r.price_egp) || 0,
      lectureCount: Number(r.lecture_count) || 0,
      watchedCount: Number(r.watched_count) || 0,
      totalMinutes: Math.round((Number(r.total_seconds) || 0) / 60),
      lectureLimit: r.access_type === 'limited' ? (Number(r.lecture_limit) || 0) : null,
      status: r.status,
    })));
  } catch (e) { logger.error("[course-access]", e.message); res.status(500).json({ error: "Internal server error" }); }
});

router.put('/api/admin/subscribers/:id/course-access/:enrollmentId', requireAuth, requireAdminOrStaff, requirePermission('manage_courses'), async (req, res) => {
  try {
    const tenantId = req.tenantId || DEFAULT_TENANT_ID;
    const { expiresAt, addMonths } = req.body || {};
    const [[enrolment]] = await pool.query(
      'SELECT id, expiry_date FROM enrollments WHERE id=? AND subscriber_id=? AND tenant_id=? LIMIT 1',
      [req.params.enrollmentId, req.params.id, tenantId]);
    if (!enrolment) return res.status(404).json({ error: 'التسجيل غير موجود' });

    // Three ways to say it, because all three are things staff actually ask
    // for: add months to whatever is there, set an exact date, or clear it.
    if (Number(addMonths)) {
      const months = Math.trunc(Number(addMonths));
      await pool.query(
        `UPDATE enrollments SET expiry_date = DATE_ADD(COALESCE(expiry_date, NOW()), INTERVAL ? MONTH)
          WHERE id=? AND tenant_id=?`, [months, enrolment.id, tenantId]);
    } else if (expiresAt === null || expiresAt === '') {
      await pool.query('UPDATE enrollments SET expiry_date = NULL WHERE id=? AND tenant_id=?', [enrolment.id, tenantId]);
    } else if (expiresAt) {
      const parsed = new Date(expiresAt);
      if (!Number.isFinite(parsed.getTime())) return res.status(400).json({ error: 'تاريخ غير صالح' });
      await pool.query('UPDATE enrollments SET expiry_date = ? WHERE id=? AND tenant_id=?',
        [parsed.toISOString().slice(0, 19).replace('T', ' '), enrolment.id, tenantId]);
    } else {
      return res.status(400).json({ error: 'حدد تاريخ أو عدد شهور' });
    }

    const [[updated]] = await pool.query(
      'SELECT expiry_date FROM enrollments WHERE id=? AND tenant_id=?', [enrolment.id, tenantId]);
    res.json({ ok: true, expiresAt: updated?.expiry_date ?? null });
  } catch (e) { logger.error("[course-access-update]", e.message); res.status(500).json({ error: "Internal server error" }); }
});

router.post('/api/admin/enrollments', requireAuth, requireAdminOrStaff, requirePermission('manage_courses'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const tenantId = req.tenantId || req.user?.tenant_id || 'tenant-default';
    const { subscriber_id, course_id, bundle_id, access_level, lecture_limit } = req.body || {};
    if (!subscriber_id || (!course_id && !bundle_id) || (course_id && bundle_id)) {
      return res.status(400).json({ error: 'subscriber_id and exactly one of course_id or bundle_id required' });
    }
    await conn.beginTransaction();
    transactionStarted = true;
    const result = await grantCourseSelections({
      tenantId,
      subscriberId: subscriber_id,
      selections: [{
        courseId: bundle_id ? `bundle:${bundle_id}` : course_id,
        accessType: access_level,
        lectureLimit: lecture_limit,
      }],
      source: 'manual_enrollment',
      actor: req.user?.email || req.staffRecord?.name || 'admin',
    }, conn);
    if (!result.courseIds.length) {
      await conn.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'Course or bundle has no available courses' });
    }
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true, enrolledCourseIds: result.courseIds });
  } catch (error) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[admin-enrollment]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

module.exports = router;
