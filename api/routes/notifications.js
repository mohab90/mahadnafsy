'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router = express.Router();

const { pool } = require('../lib/db');
const { ensureNotificationsTable } = require('../lib/notification');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// GET /api/admin/notifications
router.get('/api/admin/notifications', requireAuth, requireAdmin, async (_req, res) => {
  try {
    await ensureNotificationsTable();
    const [rows] = await pool.query(
      `SELECT id, type, title, message, data_json, read_at, created_at
       FROM notifications ORDER BY created_at DESC LIMIT 100`
    );
    const unread = rows.filter(r => !r.read_at).length;
    res.json({ rows, unread });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/admin/notifications/read-all
router.patch('/api/admin/notifications/read-all', requireAuth, requireAdmin, async (_req, res) => {
  try {
    await ensureNotificationsTable();
    await pool.query('UPDATE notifications SET read_at=NOW() WHERE read_at IS NULL');
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
    await pool.query('UPDATE notifications SET read_at=NOW() WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
