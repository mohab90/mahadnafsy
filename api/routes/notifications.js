'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router = express.Router();

const { pool } = require('../lib/db');
const { ensureNotificationsTable } = require('../lib/notification');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// GET /api/admin/notifications
router.get('/api/admin/notifications', requireAuth, requireAdmin, async (req, res) => {
  try {
    await ensureNotificationsTable();
    const [rows] = await pool.query(
      `SELECT id, type, title, message, data_json, read_at, created_at
       FROM notifications WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100`,
      [req.tenantId]
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
router.patch('/api/admin/notifications/read-all', requireAuth, requireAdmin, async (req, res) => {
  try {
    await ensureNotificationsTable();
    await pool.query('UPDATE notifications SET read_at=NOW() WHERE tenant_id=? AND read_at IS NULL', [req.tenantId]);
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/admin/notifications/:id/read
router.patch('/api/admin/notifications/:id/read', requireAuth, requireAdmin, async (req, res) => {
  try {
    await ensureNotificationsTable();
    const [result] = await pool.query('UPDATE notifications SET read_at=NOW() WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Notification not found' });
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/notifications/:id — NotifInboxMgmtTab.tsx's delete button (NOT-01/02).
router.delete('/api/admin/notifications/:id', requireAuth, requireAdmin, async (req, res) => {
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
