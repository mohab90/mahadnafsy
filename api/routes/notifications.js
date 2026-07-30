'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router = express.Router();

const { pool } = require('../lib/db');
const { ensureNotificationsTable } = require('../lib/notification');
const { requireAuth, requireAdminOrStaff, requirePermission, requireAnyPermission } = require('../middleware/auth');

const viewerKey = req => req.staffRecord?.id
  ? `staff:${req.staffRecord.id}`
  : `admin:${req.user?.uid || String(req.user?.email || '').toLowerCase()}`;
const visibilitySql = req => req.isSuperAdmin
  ? { sql: '', params: [] }
  : { sql: ' AND (n.recipient_staff_id IS NULL OR n.recipient_staff_id=?)', params: [req.staffRecord.id] };

// GET /api/admin/notifications
router.get('/api/admin/notifications', requireAuth, requireAdminOrStaff, requireAnyPermission('manage_notifications', 'manage_inbox'), async (req, res) => {
  try {
    await ensureNotificationsTable();
    const visibility = visibilitySql(req);
    const [rows] = await pool.query(
      `SELECT n.id, n.type, n.title, n.message, n.data_json,
              COALESCE(r.read_at, n.read_at) AS read_at, n.created_at
         FROM notifications n
         LEFT JOIN notification_reads r
           ON r.notification_id=n.id AND r.tenant_id=n.tenant_id AND r.viewer_key=?
        WHERE n.tenant_id=?${visibility.sql}
        ORDER BY n.created_at DESC LIMIT 100`,
      [viewerKey(req), req.tenantId, ...visibility.params]
    );
    const unread = rows.filter(r => !r.read_at).length;
    res.json({ rows, unread });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PERF-04: PUT /api/admin/notifications used to live here — a bulk upsert (up to
// 200 items, each doing a SELECT-then-INSERT-or-UPDATE, so up to 400 sequential
// queries per call) for admin broadcast notifications. Its own comment claimed the
// frontend's saveNotifications()/persistNotificationsToConfig() called it, but that
// helper actually PUTs to /api/admin/notification-settings (routes/config.js — a
// single JSON-blob tenant setting, not this table) — this route had zero callers.
// Removed rather than optimized.

// PATCH /api/admin/notifications/read-all
router.patch('/api/admin/notifications/read-all', requireAuth, requireAdminOrStaff, requireAnyPermission('manage_notifications', 'manage_inbox'), async (req, res) => {
  try {
    await ensureNotificationsTable();
    const visibility = visibilitySql(req);
    await pool.query(
      `INSERT INTO notification_reads (notification_id, tenant_id, viewer_key, read_at)
       SELECT n.id, n.tenant_id, ?, NOW()
         FROM notifications n
        WHERE n.tenant_id=?${visibility.sql}
       ON DUPLICATE KEY UPDATE read_at=VALUES(read_at)`,
      [viewerKey(req), req.tenantId, ...visibility.params]);
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/admin/notifications/:id/read
router.patch('/api/admin/notifications/:id/read', requireAuth, requireAdminOrStaff, requireAnyPermission('manage_notifications', 'manage_inbox'), async (req, res) => {
  try {
    await ensureNotificationsTable();
    const visibility = visibilitySql(req);
    const [result] = await pool.query(
      `INSERT INTO notification_reads (notification_id, tenant_id, viewer_key, read_at)
       SELECT n.id, n.tenant_id, ?, NOW()
         FROM notifications n
        WHERE n.id=? AND n.tenant_id=?${visibility.sql}
       ON DUPLICATE KEY UPDATE read_at=VALUES(read_at)`,
      [viewerKey(req), req.params.id, req.tenantId, ...visibility.params]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Notification not found' });
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/notifications/:id — NotifInboxMgmtTab.tsx's delete button (NOT-01/02).
router.delete('/api/admin/notifications/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_notifications'), async (req, res) => {
  try {
    await ensureNotificationsTable();
    const [result] = await pool.query('DELETE FROM notifications WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Notification not found' });
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
