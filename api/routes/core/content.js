'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../../lib/logger');
const { pool } = require('../../lib/db');
const { grantCourseSelections, grantCourseEntitlement, revokeCourseEntitlement } = require('../../lib/entitlements');
const { financialRecordMatches, resolveFinancialScope } = require('../../lib/financialScope');
const { logLeadEvent } = require('../../lib/crm');
const { sanitize } = require('../../lib/helpers');
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

// manage_courses means "author the catalogue", and only the online manager
// holds it. Changing how many videos one customer may watch is not authoring
// anything — it is the access that customer paid for, so it belongs with the
// money. The unified client page already showed these buttons to the
// collection manager, who then got «Permission denied: manage_courses»:
// the screen offered an action the server refused.
router.put('/api/admin/subscribers/:id/course-access/:enrollmentId', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
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

// «التقسيط يقفل بتحديد من التحصيل أو خدمة العملاء» — closing a course on a
// client who stopped paying, and opening it again.
//
// Instalment access is already proportional: paying a third of the price opens
// a third of the lectures. What had no way back was the other direction — a
// client who stops paying keeps whatever they had reached, and no screen took
// it away. revokeCourseEntitlement and grantCourseEntitlement sat in the
// library with no route and no button between them.
//
// manage_subscribers is the gate because collection and customer service are
// the two desks that find out a client has stopped paying, and they are the
// two roles that hold it — manage_financial, which the buttons above use,
// excludes customer service.
//
// Deliberately a decision somebody makes and signs, not a nightly job: an
// overdue instalment is a phone call before it is a lock. And it is not final —
// the next instalment recorded against the course grants it again through the
// ordinary payment path, which is the right answer when non-payment was the
// reason it closed.
router.post('/api/admin/subscribers/:id/course-access', requireAuth, requireAdminOrStaff, requirePermission('manage_subscribers'), async (req, res) => {
  try {
    const tenantId = req.tenantId || DEFAULT_TENANT_ID;
    const courseId = String(req.body?.courseId || '').trim();
    const action = String(req.body?.action || '').trim().toLowerCase();
    const reason = sanitize(String(req.body?.reason || ''), 300).trim();
    if (!courseId) return res.status(400).json({ error: 'حدد الكورس' });
    if (action !== 'close' && action !== 'open') {
      return res.status(400).json({ error: 'الإجراء لازم يكون قفل أو فتح' });
    }
    if (action === 'close' && !reason) {
      return res.status(400).json({ error: 'اكتب سبب قفل الكورس — بيتسجل في ملف العميل' });
    }

    const [[subscriber]] = await pool.query(
      `SELECT id, name, lead_id, branch_id, assigned_cs_id, assigned_sales_id
         FROM subscribers WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1`,
      [req.params.id, tenantId]);
    if (!subscriber) return res.status(404).json({ error: 'العميل غير موجود' });

    // The same row-level rule the money screens use: the managers see everyone,
    // a branch manager only their branch, collection and customer service only
    // the clients assigned to them. Without it manage_subscribers would let any
    // of them close a course for a client who is not theirs.
    let scope;
    try {
      scope = resolveFinancialScope(req, { allowAssigned: true });
    } catch (error) {
      return res.status(error.status || 403).json({ error: 'العميل ده خارج نطاقك', code: error.code || 'OUT_OF_SCOPE' });
    }
    if (!financialRecordMatches(scope, subscriber)) {
      return res.status(403).json({ error: 'العميل ده خارج نطاقك', code: 'OUT_OF_SCOPE' });
    }

    const [[enrolment]] = await pool.query(
      `SELECT id, status, access_type, lecture_limit FROM enrollments
        WHERE tenant_id=? AND subscriber_id=? AND course_id=? LIMIT 1`,
      [tenantId, subscriber.id, courseId]);
    if (!enrolment) return res.status(404).json({ error: 'العميل مش مشترك في الكورس ده' });

    const actor = req.staffRecord?.id || req.user?.id || null;
    const actorName = req.staffRecord?.name || req.user?.name || '';
    let result;
    if (action === 'close') {
      result = await revokeCourseEntitlement({
        tenantId, subscriberId: subscriber.id, courseId,
        source: 'desk_hold', actor, reason,
      });
    } else {
      // Give back exactly what was taken. The access type and lecture count are
      // named explicitly so the proportional arithmetic does not recompute a
      // smaller number — lectures published since they paid would otherwise
      // shrink the share they had already been given.
      const limited = enrolment.access_type === 'limited';
      result = await grantCourseEntitlement({
        tenantId, subscriberId: subscriber.id, courseId,
        accessType: limited ? 'limited' : 'full',
        lectureLimit: limited ? (Number(enrolment.lecture_limit) || 1) : null,
        branchId: subscriber.branch_id || null,
        source: 'desk_release', actor,
      });
    }

    // entitlement_events already holds the machine record. This is the human
    // one: collection works out of the client's timeline, and a course that
    // went quiet has to say there who closed it and what for.
    if (subscriber.lead_id) {
      await logLeadEvent(
        subscriber.lead_id,
        action === 'close' ? 'course_access_closed' : 'course_access_opened',
        action === 'close'
          ? `تم قفل الوصول للكورس — ${reason}`
          : `تم فتح الوصول للكورس مرة تانية${reason ? ` — ${reason}` : ''}`,
        { courseId, actor, actorName, reason: reason || null },
        tenantId);
    }

    res.json({
      ok: true,
      action,
      changed: !!result?.changed,
      status: action === 'close' ? 'revoked' : 'active',
    });
  } catch (e) {
    logger.error('[course-access-state]', e.message);
    res.status(e?.statusCode || 500).json({ error: e?.statusCode ? e.message : 'Internal server error' });
  }
});

// Same permission, same reason: enrolling a customer and setting their video
// count is a client action, not a catalogue one.
router.post('/api/admin/enrollments', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
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
