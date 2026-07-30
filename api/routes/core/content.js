'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../../lib/logger');
const { pool } = require('../../lib/db');
const { grantCourseSelections } = require('../../lib/entitlements');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');

// The only non-duplicate responsibility retained from the old content router.
// Manual enrollment is tenant-scoped and atomic; payment-driven enrollment is
// handled by the payment workflow instead.
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
