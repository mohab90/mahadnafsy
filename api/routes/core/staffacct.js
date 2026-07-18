'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../../lib/logger');
const { pool } = require('../../lib/db');
const { tryJson, parseLimit } = require('../../lib/helpers');
const { requireAuth, requireAdmin } = require('../../middleware/auth');

router.get('/api/staff/me/preferences', requireAuth, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenant_id || 'tenant-default';
    const email = String(req.user?.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'No email in token' });
    const [[row]] = await pool.query(
      'SELECT preferences_json FROM staff WHERE tenant_id=? AND LOWER(TRIM(email))=? AND is_active=1 LIMIT 1',
      [tenantId, email]
    );
    if (!row) return res.status(404).json({ error: 'Staff not found' });
    res.json(row.preferences_json ? tryJson(row.preferences_json, {}) : {});
  } catch (error) {
    logger.error('[staff-preferences]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/api/staff/me/preferences', requireAuth, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenant_id || 'tenant-default';
    const email = String(req.user?.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'No email in token' });
    const body = req.body || {};
    const preferences = {
      waNumber: typeof body.waNumber === 'string' ? body.waNumber.slice(0, 30) : '',
      waTemplates: Array.isArray(body.waTemplates) ? body.waTemplates.slice(0, 50) : [],
      customTags: Array.isArray(body.customTags) ? body.customTags.slice(0, 100).map(tag => String(tag).slice(0, 40)) : [],
    };
    const [result] = await pool.query(
      'UPDATE staff SET preferences_json=? WHERE tenant_id=? AND LOWER(TRIM(email))=? AND is_active=1',
      [JSON.stringify(preferences), tenantId, email]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Staff not found' });
    res.json({ ok: true });
  } catch (error) {
    logger.error('[staff-preferences]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/api/admin/consultations', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 500, 2000);
    const [rows] = await pool.query(
      `SELECT c.*, t.name AS t_name, t.specialty AS t_specialty
         FROM consultations c LEFT JOIN therapists t ON t.id=c.therapist_id
        WHERE c.tenant_id=? AND c.deleted_at IS NULL
        ORDER BY c.session_date DESC LIMIT ?`,
      [req.tenantId, limit]
    );
    res.json(rows);
  } catch (error) {
    logger.error('[admin-consultations]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
