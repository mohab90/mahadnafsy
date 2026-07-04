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
    // Lifecycle: notify the learner when their certificate is issued/delivered.
    if (['ISSUED', 'AT_BRANCH', 'DELIVERED'].includes(status.toUpperCase())) {
      setImmediate(async () => {
        try {
          const [[row]] = await pool.query(
            `SELECT s.name, s.email, s.phone, c.title AS course_title
             FROM certificate_requests cr
             LEFT JOIN subscribers s ON s.id = cr.subscriber_id
             LEFT JOIN courses c ON c.id = cr.course_id
             WHERE cr.id=? LIMIT 1`, [req.params.id]);
          if (row?.email || row?.phone) {
            require('../lib/lifecycle').trigger(
              'certificate_ready',
              { name: row.name, email: row.email, phone: row.phone, courseTitle: row.course_title },
              { dedupeKey: `cert_ready:${req.params.id}` }
            );
          }
        } catch (e) { logger.warn('[lifecycle] certificate_ready failed:', e.message); }
      });
    }
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/api/admin/certificate-requests/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM certificate_requests WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Customer certificate request → single source of truth = certificate_requests table ──
// (Previously the client wrote cert requests into crm_json.extraCertificateRequests, which the
//  admin never read → requests vanished. Now customers write to the same table the admin manages.)
const CERT_TYPES = ['SOCIAL_SOLIDARITY','AIN_SHAMS','EXPERIENCE_EXTERNAL','PRACTICE_EXTERNAL','NATIONAL_COUNCIL','AMERICAN_BOARD','INSTITUTE','OTHER'];
const CERT_NATS  = ['EGYPTIAN','NON_EGYPTIAN_EGYPT','SAUDI_RESIDENT','INTERNATIONAL'];
router.post('/api/me/certificate-request', requireAuth, async (req, res) => {
  try {
    const email = req.user.email?.toLowerCase().trim();
    const [[sub]] = await pool.query('SELECT id FROM subscribers WHERE LOWER(TRIM(email))=? LIMIT 1', [email]);
    if (!sub) return res.status(403).json({ error: 'not_subscribed' });
    const b = req.body || {};
    const type = CERT_TYPES.includes(String(b.type || '').toUpperCase()) ? String(b.type).toUpperCase() : 'OTHER';
    const nationality = CERT_NATS.includes(String(b.nationality || '').toUpperCase()) ? String(b.nationality).toUpperCase() : null;
    await pool.query(
      `INSERT INTO certificate_requests
         (id, subscriber_id, course_id, type, custom_name, name_ar, name_en, nationality, id_number, status, price, currency, note, requested_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, NOW())`,
      [sub.id, b.courseId || null, type, b.customName || null, b.nameAr || null, b.nameEn || null,
       nationality, b.idNumber || null, b.price != null ? Number(b.price) : null,
       (b.currency && ['EGP','SAR','USD'].includes(b.currency)) ? b.currency : null, b.note || null]
    );
    res.json({ ok: true, status: 'pending' });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
