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

// PUT /api/admin/notifications — persist admin broadcast notifications.
// The frontend (saveNotifications/persistNotificationsToConfig) called this, but no
// handler existed → broadcasts were lost on reload (the .catch() hid the 404).
// Upserts into the SAME table the GET above reads from, so they round-trip.
router.put('/api/admin/notifications', requireAuth, requireAdmin, async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : (req.body && Array.isArray(req.body.notifications) ? req.body.notifications : []);
    await ensureNotificationsTable();
    const { uuidv4 } = require('../lib/id');
    let saved = 0;
    for (const n of items) {
      if (!n || typeof n !== 'object') continue;
      await pool.query(
        `INSERT INTO notifications (id, type, title, message, data_json, created_at)
         VALUES (?,?,?,?,?, NOW())
         ON DUPLICATE KEY UPDATE type=VALUES(type), title=VALUES(title), message=VALUES(message), data_json=VALUES(data_json)`,
        [n.id || uuidv4(), String(n.type || 'broadcast'), String(n.title || ''),
         String(n.message || n.body || ''), JSON.stringify(n.data || n.meta || {})]
      ).then(() => { saved++; }).catch(e => logger.warn('[notif upsert]', e.message));
    }
    res.json({ ok: true, saved });
  } catch (e) { logger.error('[notifications save]', e.message); res.status(500).json({ error: 'Internal server error' }); }
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
