'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router  = express.Router();

const { pool } = require('../lib/db');
const { parseLimit } = require('../lib/helpers');
const { publishRealtimeEvent } = require('../lib/realtime');
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
       LEFT JOIN subscribers s ON s.id = cr.subscriber_id AND s.tenant_id=cr.tenant_id
       LEFT JOIN courses c ON c.id = cr.course_id AND c.tenant_id=cr.tenant_id
       WHERE cr.tenant_id=?
       ORDER BY cr.requested_at DESC LIMIT ?`, [req.tenantId, limit]);
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
    params.push(req.params.id, req.tenantId);
    if (['ISSUED', 'AT_BRANCH', 'DELIVERED'].includes(status.toUpperCase())) {
      const [[eligible]] = await pool.query(
        `SELECT cr.id
           FROM certificate_requests cr
           JOIN enrollments e ON e.subscriber_id=cr.subscriber_id AND e.course_id=cr.course_id AND e.tenant_id=cr.tenant_id
           JOIN course_completions cc ON cc.subscriber_id=cr.subscriber_id AND cc.course_id=cr.course_id AND cc.tenant_id=cr.tenant_id
          WHERE cr.id=? AND cr.tenant_id=? AND cr.status IN ('PAID','IN_PROGRESS','NOT_SENT','ISSUED','AT_BRANCH') LIMIT 1`,
        [req.params.id, req.tenantId]
      );
      if (!eligible) return res.status(409).json({ error: 'لا يمكن إصدار شهادة قبل الدفع وإتمام الكورس' });
    }
    const [updated] = await pool.query(`UPDATE certificate_requests SET ${sets.join(',')} WHERE id=? AND tenant_id=?`, params);
    if (!updated.affectedRows) return res.status(404).json({ error: 'Not found' });
    // Lifecycle: notify the learner when their certificate is issued/delivered.
    if (['ISSUED', 'AT_BRANCH', 'DELIVERED'].includes(status.toUpperCase())) {
      setImmediate(async () => {
        try {
          const [[row]] = await pool.query(
            `SELECT s.name, s.email, s.phone, c.title AS course_title
             FROM certificate_requests cr
             LEFT JOIN subscribers s ON s.id = cr.subscriber_id AND s.tenant_id=cr.tenant_id
             LEFT JOIN courses c ON c.id = cr.course_id AND c.tenant_id=cr.tenant_id
             WHERE cr.id=? AND cr.tenant_id=? LIMIT 1`, [req.params.id, req.tenantId]);
          if (row?.email || row?.phone) {
            require('../lib/lifecycle').trigger(
              'certificate_ready',
              { name: row.name, email: row.email, phone: row.phone, courseTitle: row.course_title },
              { dedupeKey: `cert_ready:${req.params.id}` }
            );
            if (row.email) {
              publishRealtimeEvent('client:certificate-updated', {
                status: status.toUpperCase(),
                courseTitle: row.course_title,
                message: 'تم تحديث حالة الشهادة الخاصة بك.',
              }, { room: `user:${String(row.email).toLowerCase().trim()}` }).catch(() => {});
            }
          }
        } catch (e) { logger.warn('[lifecycle] certificate_ready failed:', e.message); }
      });
    }
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/api/admin/certificate-requests/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [deleted] = await pool.query('DELETE FROM certificate_requests WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
    if (!deleted.affectedRows) return res.status(404).json({ error: 'Not found' });
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
    const tenantId = req.tenantId || req.user?.tenant_id || 'tenant-default';
    const email = req.user.email?.toLowerCase().trim();
    const [[sub]] = await pool.query('SELECT id FROM subscribers WHERE tenant_id=? AND LOWER(TRIM(email))=? LIMIT 1', [tenantId, email]);
    if (!sub) return res.status(403).json({ error: 'not_subscribed' });
    const b = req.body || {};
    const type = CERT_TYPES.includes(String(b.type || '').toUpperCase()) ? String(b.type).toUpperCase() : 'OTHER';
    const nationality = CERT_NATS.includes(String(b.nationality || '').toUpperCase()) ? String(b.nationality).toUpperCase() : null;
    if (!b.courseId) return res.status(400).json({ error: 'courseId required' });
    const [[eligible]] = await pool.query(
      `SELECT e.id
         FROM enrollments e
         JOIN course_completions cc ON cc.subscriber_id=e.subscriber_id AND cc.course_id=e.course_id AND cc.tenant_id=e.tenant_id
        WHERE e.subscriber_id=? AND e.course_id=? AND e.tenant_id=?
          AND EXISTS (
            SELECT 1 FROM payments p
             WHERE p.subscriber_id=e.subscriber_id AND p.tenant_id=e.tenant_id
               AND p.status='paid' AND p.deleted_at IS NULL
               AND (p.course_id=e.course_id OR EXISTS (
                 SELECT 1 FROM bundle_courses bc WHERE bc.bundle_id=p.bundle_id AND bc.course_id=e.course_id AND bc.tenant_id=e.tenant_id
               ))
          ) LIMIT 1`,
      [sub.id, b.courseId, tenantId]
    );
    if (!eligible) return res.status(409).json({ error: 'certificate_not_eligible', message: 'يجب دفع وإتمام الكورس أولاً' });

    const [[contentRow]] = await pool.query("SELECT `value` FROM site_config WHERE `key`='content' LIMIT 1");
    const pricing = (() => { try { return JSON.parse(JSON.parse(contentRow?.value || '{}').extra_cert_pricing || '{}'); } catch { return {}; } })();
    const typeKey = type.toLowerCase();
    const priceRow = pricing[typeKey] || {};
    const priceKey = nationality === 'EGYPTIAN' ? 'egyptianEGP'
      : nationality === 'NON_EGYPTIAN_EGYPT' ? 'residentEGP'
        : nationality === 'SAUDI_RESIDENT' ? 'residentSAR' : 'foreignUSD';
    const price = Number(priceRow[priceKey]) || null;
    const currency = priceKey.endsWith('SAR') ? 'SAR' : priceKey.endsWith('USD') ? 'USD' : 'EGP';
    const requestId = require('crypto').randomUUID();
    await pool.query(
      `INSERT INTO certificate_requests
         (id, subscriber_id, course_id, type, custom_name, name_ar, name_en, nationality, id_number, status, price, currency, note, tenant_id, requested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [requestId, sub.id, b.courseId, type, b.customName || null, b.nameAr || null, b.nameEn || null,
       nationality, b.idNumber || null, price ? 'PRICED' : 'PENDING', price, price ? currency : null,
       b.note || null, tenantId]
    );
    res.json({ ok: true, id: requestId, status: price ? 'priced' : 'pending', price, currency: price ? currency : null });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
