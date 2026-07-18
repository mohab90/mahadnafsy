'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../../lib/logger');
const { uuidv4 } = require('../../lib/id');
const { pool } = require('../../lib/db');
const { requireAuth, requireAdminOrStaff } = require('../../middleware/auth');

// The only non-duplicate responsibility retained from the old content router.
// Manual enrollment is tenant-scoped and atomic; payment-driven enrollment is
// handled by the payment workflow instead.
router.post('/api/admin/enrollments', requireAuth, requireAdminOrStaff, async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    if (!req.isSuperAdmin) {
      const role = String(req.staffRecord?.role || '').toLowerCase();
      if (!['admin', 'manager', 'online_manager'].includes(role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
    }
    const tenantId = req.tenantId || req.user?.tenant_id || 'tenant-default';
    const { subscriber_id, course_id, bundle_id, access_level, lecture_limit } = req.body || {};
    if (!subscriber_id || (!course_id && !bundle_id) || (course_id && bundle_id)) {
      return res.status(400).json({ error: 'subscriber_id and exactly one of course_id or bundle_id required' });
    }
    await conn.beginTransaction();
    transactionStarted = true;
    const [[subscriber]] = await conn.query(
      'SELECT id, branch_id FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [subscriber_id, tenantId]
    );
    if (!subscriber) { await conn.rollback(); transactionStarted = false; return res.status(404).json({ error: 'Subscriber not found' }); }
    const accessType = access_level === 'limited' ? 'limited' : 'full';
    const courseIds = [];
    if (course_id) {
      const [[course]] = await conn.query('SELECT id FROM courses WHERE id=? AND tenant_id=? LIMIT 1', [course_id, tenantId]);
      if (!course) { await conn.rollback(); transactionStarted = false; return res.status(404).json({ error: 'Course not found' }); }
      courseIds.push(course.id);
    } else {
      const [rows] = await conn.query(
        `SELECT bc.course_id FROM bundle_courses bc
          JOIN bundles b ON b.id=bc.bundle_id AND b.tenant_id=?
          JOIN courses c ON c.id=bc.course_id AND c.tenant_id=?
         WHERE bc.bundle_id=?`,
        [tenantId, tenantId, bundle_id]
      );
      if (!rows.length) { await conn.rollback(); transactionStarted = false; return res.status(404).json({ error: 'Bundle has no courses' }); }
      courseIds.push(...rows.map(row => row.course_id));
    }
    for (const enrolledCourseId of courseIds) {
      await conn.query(
        `INSERT INTO enrollments (id, subscriber_id, course_id, bundle_id, enrolled_at, access_type, lecture_limit, tenant_id, branch_id)
         SELECT ?,?,?,?,?,?,?,?,?
         WHERE NOT EXISTS (SELECT 1 FROM enrollments WHERE subscriber_id=? AND course_id=? AND tenant_id=?)`,
        [uuidv4(), subscriber_id, enrolledCourseId, bundle_id || null, new Date(), accessType,
         lecture_limit || null, tenantId, subscriber.branch_id || 'branch-other', subscriber_id, enrolledCourseId, tenantId]
      );
    }
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true, enrolledCourseIds: courseIds });
  } catch (error) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[admin-enrollment]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

module.exports = router;
