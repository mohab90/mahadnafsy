'use strict';

const express = require('express');
const { createHash } = require('crypto');
const router = express.Router();

const { pool } = require('../lib/db');
const { ADMIN_EMAILS, ADMIN_UIDS, requireAuth } = require('../middleware/auth');
const { sanitize } = require('../lib/helpers');
const logger = require('../lib/logger').child({ route: 'profile' });

// Staff identity check for the authenticated tenant.
router.get('/api/me/is-staff', requireAuth, async (req, res) => {
  try {
    const { uid, email } = req.user;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const configuredAdminEmails = ADMIN_EMAILS.map(value => value.trim().toLowerCase());
    if (ADMIN_UIDS.includes(uid) || configuredAdminEmails.includes(normalizedEmail)) {
      return res.json({ isStaff: true, isAdmin: true });
    }
    const [[row]] = await pool.query(
      `SELECT id, role
       FROM staff
       WHERE tenant_id = ?
         AND (firebase_uid = ? OR LOWER(TRIM(email)) = ?)
         AND is_active = 1
         AND deleted_at IS NULL
       LIMIT 1`,
      [req.tenantId, uid, normalizedEmail]
    );
    res.json({ isStaff: !!row, isAdmin: false, staffId: row?.id, role: row?.role });
  } catch (e) {
    logger.error('profile route failed', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logged-in user opts in for a course / confirms interest.
router.post('/api/me/register-interest', requireAuth, async (req, res) => {
  try {
    const { name, phone, source } = req.body || {};
    const { uid, email } = req.user;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const safeName = sanitize(name || normalizedEmail.split('@')[0] || 'مستخدم', 255);
    const safePhone = sanitize(phone || '', 50);
    const safeSource = sanitize(source || 'تسجيل اهتمام', 255);
    // Stable per tenant + account, so retries cannot create duplicate interest leads.
    const digest = createHash('sha256')
      .update(`${req.tenantId}:${uid || normalizedEmail}`)
      .digest('hex')
      .slice(0, 32);
    const id = `reg-${digest}`;

    await pool.query(
      `INSERT INTO leads (id, tenant_id, name, email, phone, source, status)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         name=VALUES(name),
         email=VALUES(email),
         phone=VALUES(phone),
         source=VALUES(source),
         hidden=0,
         deleted_at=NULL`,
      [id, req.tenantId, safeName, normalizedEmail || null, safePhone || null, safeSource, 'new']
    );
    res.json({ ok: true, leadId: id });
  } catch (e) {
    logger.error('profile route failed', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
