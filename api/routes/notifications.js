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

// PUT /api/admin/notifications — persist admin broadcast notifications.
// The frontend (saveNotifications/persistNotificationsToConfig) called this, but no
// handler existed → broadcasts were lost on reload (the .catch() hid the 404).
// Upserts into the SAME table the GET above reads from, so they round-trip.
router.put('/api/admin/notifications', requireAuth, requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const items = Array.isArray(req.body) ? req.body : (req.body && Array.isArray(req.body.notifications) ? req.body.notifications : []);
    if (items.length > 200) return res.status(400).json({ error: 'Too many notifications' });
    await ensureNotificationsTable();
    const { uuidv4 } = require('../lib/id');
    let saved = 0;
    await conn.beginTransaction();
    for (const n of items) {
      if (!n || typeof n !== 'object') continue;
      const id = n.id || uuidv4();
      const values = [String(n.type || 'broadcast').slice(0, 50), String(n.title || '').slice(0, 255),
        String(n.message || n.body || '').slice(0, 10000), JSON.stringify(n.data || n.meta || {})];
      const [[existing]] = await conn.query('SELECT id FROM notifications WHERE id=? AND tenant_id=? LIMIT 1', [id, req.tenantId]);
      if (existing) {
        await conn.query(
          'UPDATE notifications SET type=?, title=?, message=?, data_json=? WHERE id=? AND tenant_id=?',
          [...values, id, req.tenantId]
        );
      } else {
        await conn.query(
          `INSERT INTO notifications (id, tenant_id, type, title, message, data_json, created_at)
           VALUES (?,?,?,?,?,?, NOW())`,
          [id, req.tenantId, ...values]
        );
      }
      saved++;
    }
    await conn.commit();
    res.json({ ok: true, saved });
  } catch (e) { try { await conn.rollback(); } catch (_) {} logger.error('[notifications save]', e.message); res.status(500).json({ error: 'Internal server error' }); }
  finally { conn.release(); }
});

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

module.exports = router;
