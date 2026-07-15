'use strict';

const express = require('express');
const router = express.Router();

const { pool } = require('../lib/db');
const { ADMIN_EMAILS, ADMIN_UIDS, requireAuth } = require('../middleware/auth');
const logger = require('../lib/logger').child({ route: 'profile' });

// ── is-staff check ────────────────────────────────────────────────────────────
router.get('/api/me/is-staff', requireAuth, async (req, res) => {
  try {
    const { uid, email } = req.user;
    if (ADMIN_UIDS.includes(uid) || ADMIN_EMAILS.includes(email||'')) {
      return res.json({ isStaff: true, isAdmin: true });
    }
    const [[row]] = await pool.query(
      'SELECT id, role FROM staff WHERE (firebase_uid = ? OR email = ?) AND is_active = 1 LIMIT 1',
      [uid, email||'']
    );
    res.json({ isStaff: !!row, isAdmin: false, staffId: row?.id, role: row?.role });
  } catch (e) { logger.error('profile route failed', { error: e.message }); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Register activity (logged-in user opts in for a course / confirms interest) ─
// Was incorrectly named /api/auth/register — renamed to avoid duplicate route conflict.
router.post('/api/me/register-interest', requireAuth, async (req, res) => {
  try {
    const { name, phone, source } = req.body;
    const { uid, email } = req.user;
    // Auto-create lead in DB
    const id = `reg-${uid}`;
    await pool.query(
      `INSERT IGNORE INTO leads (id, name, email, phone, source, status)
       VALUES (?,?,?,?,?,?)`,
      [id, name||email?.split('@')[0]||'مستخدم', email||'', phone||'', source||'تسجيل اهتمام', 'new']
    );
    res.json({ ok: true });
  } catch (e) { logger.error('profile route failed', { error: e.message }); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
