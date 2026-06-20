'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router  = express.Router();

const { pool } = require('../lib/db');
const { parseLimit } = require('../lib/helpers');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { isString, isOneOf, validateBody } = require('../middleware/validate');

const CERT_STATUSES = ['PENDING','PRICED','PAID','IN_PROGRESS','NOT_SENT','ISSUED','AT_BRANCH','DELIVERED'];

// ── Certificate Requests admin routes ─────────────────────────────────────────
router.get('/api/admin/certificate-requests', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 500, 2000);
    const [rows] = await pool.query(
      `SELECT cr.*, s.name AS subscriber_name, s.phone AS subscriber_phone, c.title AS course_title
       FROM certificate_requests cr
       LEFT JOIN subscribers s ON s.id = cr.subscriber_id
       LEFT JOIN courses c ON c.id = cr.course_id
       ORDER BY cr.requested_at DESC LIMIT ?`, [limit]);
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.patch('/api/admin/certificate-requests/:id',
  requireAuth, requireAdmin,
  validateBody({
    status: v => (isString(v, 30) && isOneOf((v || '').toUpperCase(), CERT_STATUSES)) || `status must be one of: ${CERT_STATUSES.join(', ')}`,
  }),
  async (req, res) => {
  try {
    const { status, notes, price, currency, issued_at } = req.body;
    if (!status) return res.status(400).json({ error: 'status required' });
    const sets   = ['status=?'];
    const params = [status.toUpperCase()];
    if (notes     !== undefined) { sets.push('admin_note=?'); params.push(notes); }
    if (price     !== undefined) { sets.push('price=?');      params.push(Number(price)); }
    if (currency)                { sets.push('currency=?');   params.push(currency.toUpperCase()); }
    if (issued_at)               { sets.push('issued_at=?');  params.push(issued_at); }
    params.push(req.params.id);
    await pool.query(`UPDATE certificate_requests SET ${sets.join(',')} WHERE id=?`, params);
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/api/admin/certificate-requests/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM certificate_requests WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
