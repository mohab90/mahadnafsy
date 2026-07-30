'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router  = express.Router();

const { pool } = require('../lib/db');
const { parseLimit } = require('../lib/helpers');
const { publishRealtimeEvent } = require('../lib/realtime');
const { getTenantSetting } = require('../lib/tenantSettings');
const { resolveCertificatePrice } = require('../lib/certificatePricing');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { isString, isOneOf, validateBody } = require('../middleware/validate');
const { resolveClientContext } = require('../lib/clientContext');

const CERT_STATUSES = ['PENDING','PRICED','PAID','IN_PROGRESS','NOT_SENT','ISSUED','SHIPPED','AT_BRANCH','DELIVERED'];
const CERT_TYPES = ['SOCIAL_SOLIDARITY','AIN_SHAMS','EXPERIENCE_EXTERNAL','PRACTICE_EXTERNAL','NATIONAL_COUNCIL','AMERICAN_BOARD','INSTITUTE','OTHER'];
const CERT_NATS  = ['EGYPTIAN','NON_EGYPTIAN_EGYPT','SAUDI_RESIDENT','INTERNATIONAL'];
const POST_PAYMENT_STATUSES = new Set(['PAID','IN_PROGRESS','NOT_SENT','ISSUED','SHIPPED','AT_BRANCH','DELIVERED']);
const CERT_TRANSITIONS = new Map([
  ['PENDING', new Set(['PRICED', 'PAID'])],
  ['PRICED', new Set(['PAID'])],
  ['PAID', new Set(['IN_PROGRESS'])],
  ['IN_PROGRESS', new Set(['NOT_SENT', 'ISSUED'])],
  ['NOT_SENT', new Set(['IN_PROGRESS', 'ISSUED'])],
  ['ISSUED', new Set(['SHIPPED', 'AT_BRANCH', 'DELIVERED'])],
  ['SHIPPED', new Set(['AT_BRANCH', 'DELIVERED'])],
  ['AT_BRANCH', new Set(['DELIVERED'])],
  ['DELIVERED', new Set()],
]);

// ── Certificate Requests admin routes ─────────────────────────────────────────
router.get('/api/admin/certificate-requests', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 500, 2000);
    const [rows] = await pool.query(
      `SELECT cr.*, s.name AS subscriber_name, s.phone AS subscriber_phone, c.title AS course_title
       FROM certificate_requests cr
       LEFT JOIN subscribers s ON s.id = cr.subscriber_id AND s.tenant_id=cr.tenant_id AND s.deleted_at IS NULL
       LEFT JOIN courses c ON c.id = cr.course_id AND c.tenant_id=cr.tenant_id AND c.deleted_at IS NULL
       WHERE cr.tenant_id=?
       ORDER BY cr.requested_at DESC LIMIT ?`, [req.tenantId, limit]);
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/certificate-requests', requireAuth, requireAdmin, async (req, res) => {
  let conn;
  try {
    const b = req.body || {};
    const subscriberId = String(b.subscriberId || '').trim();
    const courseId = String(b.courseId || '').trim();
    const type = String(b.type || '').toUpperCase();
    const nationality = b.nationality ? String(b.nationality).toUpperCase() : null;
    if (!subscriberId || !courseId) return res.status(400).json({ error: 'subscriberId and courseId are required' });
    if (!CERT_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid certificate type' });
    if (nationality && !CERT_NATS.includes(nationality)) return res.status(400).json({ error: 'Invalid nationality' });

    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[eligible]] = await conn.query(
      `SELECT s.id
         FROM subscribers s
         JOIN enrollments e ON e.subscriber_id=s.id AND e.course_id=? AND e.tenant_id=s.tenant_id
          AND e.status='active' AND e.access_type='full'
         JOIN courses c ON c.id=e.course_id AND c.tenant_id=e.tenant_id AND c.deleted_at IS NULL
         JOIN course_completions cc ON cc.subscriber_id=s.id AND cc.course_id=e.course_id
          AND cc.tenant_id=s.tenant_id AND cc.status='active'
        WHERE s.id=? AND s.tenant_id=? AND s.deleted_at IS NULL
        LIMIT 1 FOR UPDATE`,
      [courseId, subscriberId, req.tenantId]
    );
    if (!eligible) {
      await conn.rollback();
      conn.release();
      conn = null;
      return res.status(409).json({ error: 'Subscriber must have full enrollment and an active course completion' });
    }
    const [[duplicate]] = await conn.query(
      `SELECT id FROM certificate_requests
        WHERE tenant_id=? AND subscriber_id=? AND course_id=? AND type=?
          AND status <> 'DELIVERED'
        LIMIT 1 FOR UPDATE`,
      [req.tenantId, subscriberId, courseId, type]
    );
    if (duplicate) {
      await conn.rollback();
      conn.release();
      conn = null;
      return res.status(409).json({ error: 'An active certificate request already exists', id: duplicate.id });
    }

    const suppliedPrice = b.price === undefined || b.price === null || b.price === '' ? null : Number(b.price);
    if (suppliedPrice !== null && (!Number.isFinite(suppliedPrice) || suppliedPrice < 0)) {
      await conn.rollback();
      conn.release();
      conn = null;
      return res.status(400).json({ error: 'price must be a non-negative number' });
    }
    const content = await getTenantSetting('content', { tenantId: req.tenantId, fallback: {} });
    const pricingConfig = (() => { try { return JSON.parse(content.extra_cert_pricing || '{}'); } catch { return {}; } })();
    const resolved = resolveCertificatePrice({ type, nationality, pricingConfig });
    const finalPrice = suppliedPrice === null ? resolved.price : suppliedPrice;
    const finalCurrency = String(b.currency || resolved.currency || 'EGP').toUpperCase();
    if (!/^[A-Z]{3}$/.test(finalCurrency)) {
      await conn.rollback();
      conn.release();
      conn = null;
      return res.status(400).json({ error: 'currency must be a 3-letter ISO code' });
    }
    const initialStatus = Number(finalPrice) > 0 ? 'PRICED' : 'PENDING';
    const requestId = require('crypto').randomUUID();
    await conn.query(
      `INSERT INTO certificate_requests
         (id, subscriber_id, course_id, type, custom_name, name_ar, name_en, nationality,
          id_number, status, price, paid_amount, currency, note, tenant_id, requested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NOW())`,
      [requestId, subscriberId, courseId, type, b.customName || null, b.nameAr || null, b.nameEn || null,
       nationality, b.idNumber || null, initialStatus, finalPrice, finalCurrency, b.note || null, req.tenantId]
    );
    await conn.commit();
    conn.release();
    conn = null;
    res.status(201).json({
      ok: true,
      id: requestId,
      status: initialStatus.toLowerCase(),
      price: finalPrice,
      paidAmount: 0,
      currency: finalCurrency,
    });
  } catch (e) {
    if (conn) {
      try { await conn.rollback(); } catch {}
      conn.release();
    }
    logger.error('[certificate-create]', e.message);
    if (e?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'An active certificate request already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/api/admin/certificate-requests/:id',
  requireAuth, requireAdmin,
  validateBody({
    status: v => (isString(v, 30) && isOneOf((v || '').toUpperCase(), CERT_STATUSES)) || `status must be one of: ${CERT_STATUSES.join(', ')}`,
  }),
  async (req, res) => {
  let conn;
  try {
    const { status, notes, price, currency, issued_at } = req.body;
    if (!status) return res.status(400).json({ error: 'status required' });
    const normalizedStatus = status.toUpperCase();
    const normalizedPrice = price === undefined ? undefined : Number(price);
    if (normalizedPrice !== undefined && (!Number.isFinite(normalizedPrice) || normalizedPrice < 0)) {
      return res.status(400).json({ error: 'price must be a non-negative number' });
    }
    const normalizedCurrency = currency ? String(currency).toUpperCase() : undefined;
    if (normalizedCurrency && !/^[A-Z]{3}$/.test(normalizedCurrency)) {
      return res.status(400).json({ error: 'currency must be a 3-letter ISO code' });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[request]] = await conn.query(
      'SELECT * FROM certificate_requests WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [req.params.id, req.tenantId]
    );
    if (!request) {
      await conn.rollback();
      conn.release();
      conn = null;
      return res.status(404).json({ error: 'Not found' });
    }
    const currentStatus = String(request.status).toUpperCase();
    if (currentStatus !== normalizedStatus && !CERT_TRANSITIONS.get(currentStatus)?.has(normalizedStatus)) {
      await conn.rollback();
      conn.release();
      conn = null;
      return res.status(409).json({ error: `Invalid certificate status transition: ${currentStatus} -> ${normalizedStatus}` });
    }
    const [[linkedPayment]] = await conn.query(
      `SELECT id FROM payments
        WHERE certificate_request_id=? AND subscriber_id=? AND tenant_id=?
          AND status='paid' AND deleted_at IS NULL
        LIMIT 1`,
      [request.id, request.subscriber_id, req.tenantId]
    );
    if (POST_PAYMENT_STATUSES.has(normalizedStatus) && !linkedPayment) {
        await conn.rollback();
        conn.release();
        conn = null;
        return res.status(409).json({ error: 'A paid payment linked to this certificate request is required' });
    }
    if ((linkedPayment || POST_PAYMENT_STATUSES.has(currentStatus))
      && ((normalizedPrice !== undefined && Number(normalizedPrice) !== Number(request.price))
        || (normalizedCurrency && normalizedCurrency !== String(request.currency || '').toUpperCase()))) {
      await conn.rollback();
      conn.release();
      conn = null;
      return res.status(409).json({ error: 'Certificate price and currency are immutable after payment' });
    }

    const sets = ['status=?'];
    const params = [normalizedStatus];
    if (notes !== undefined) { sets.push('admin_note=?'); params.push(notes); }
    if (normalizedPrice !== undefined) { sets.push('price=?'); params.push(normalizedPrice); }
    if (normalizedCurrency) { sets.push('currency=?'); params.push(normalizedCurrency); }
    if (issued_at) { sets.push('issued_at=?'); params.push(issued_at); }
    params.push(req.params.id, req.tenantId);

    if (['ISSUED', 'SHIPPED', 'AT_BRANCH', 'DELIVERED'].includes(normalizedStatus)) {
      const [[eligible]] = await conn.query(
        `SELECT cr.id
           FROM certificate_requests cr
           JOIN enrollments e ON e.subscriber_id=cr.subscriber_id AND e.course_id=cr.course_id AND e.tenant_id=cr.tenant_id AND e.status='active'
           JOIN course_completions cc ON cc.subscriber_id=cr.subscriber_id AND cc.course_id=cr.course_id AND cc.tenant_id=cr.tenant_id AND cc.status='active'
           JOIN payments p ON p.certificate_request_id=cr.id AND p.subscriber_id=cr.subscriber_id
                          AND p.tenant_id=cr.tenant_id AND p.status='paid' AND p.deleted_at IS NULL
          WHERE cr.id=? AND cr.tenant_id=? LIMIT 1`,
        [req.params.id, req.tenantId]
      );
      if (!eligible) {
        await conn.rollback();
        conn.release();
        conn = null;
        return res.status(409).json({ error: 'Certificate issuance requires linked payment, enrollment, and course completion' });
      }
    }
    await conn.query(`UPDATE certificate_requests SET ${sets.join(',')} WHERE id=? AND tenant_id=?`, params);
    await conn.commit();
    conn.release();
    conn = null;
    // Lifecycle: notify the learner when their certificate is issued/delivered.
    if (['ISSUED', 'SHIPPED', 'AT_BRANCH', 'DELIVERED'].includes(normalizedStatus)) {
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
              { name: row.name, email: row.email, phone: row.phone, courseTitle: row.course_title, tenantId: req.tenantId },
              { dedupeKey: `cert_ready:${req.params.id}` }
            );
            if (row.email) {
              publishRealtimeEvent('client:certificate-updated', {
                status: normalizedStatus,
                courseTitle: row.course_title,
                message: 'تم تحديث حالة الشهادة الخاصة بك.',
              }, { room: `user:${String(row.email).toLowerCase().trim()}` }).catch(() => {});
            }
          }
        } catch (e) { logger.warn('[lifecycle] certificate_ready failed:', e.message); }
      });
    }
    res.json({ ok: true });
  } catch (e) {
    if (conn) {
      try { await conn.rollback(); } catch {}
      conn.release();
    }
    logger.error('[certificate-update]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/api/admin/certificate-requests/:id', requireAuth, requireAdmin, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[request]] = await conn.query(
      'SELECT id, status FROM certificate_requests WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [req.params.id, req.tenantId]
    );
    if (!request) {
      await conn.rollback();
      conn.release();
      conn = null;
      return res.status(404).json({ error: 'Not found' });
    }
    const [[linkedPayment]] = await conn.query(
      `SELECT id FROM payments
        WHERE certificate_request_id=? AND tenant_id=? AND deleted_at IS NULL
        LIMIT 1`,
      [req.params.id, req.tenantId]
    );
    if (linkedPayment || POST_PAYMENT_STATUSES.has(String(request.status).toUpperCase())) {
      await conn.rollback();
      conn.release();
      conn = null;
      return res.status(409).json({ error: 'Paid or financially linked certificate requests cannot be deleted' });
    }
    await conn.query('DELETE FROM certificate_requests WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
    await conn.commit();
    conn.release();
    conn = null;
    res.json({ ok: true });
  } catch (e) {
    if (conn) {
      try { await conn.rollback(); } catch {}
      conn.release();
    }
    logger.error('[certificate-delete]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Customer certificate request → single source of truth = certificate_requests table ──
// (Previously the client wrote cert requests into crm_json.extraCertificateRequests, which the
//  admin never read → requests vanished. Now customers write to the same table the admin manages.)
router.post('/api/me/certificate-request', requireAuth, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenant_id || 'tenant-default';
    const email = req.user.email?.toLowerCase().trim();
    const [[sub]] = await pool.query(
      'SELECT id FROM subscribers WHERE tenant_id=? AND deleted_at IS NULL AND LOWER(TRIM(email))=? LIMIT 1',
      [tenantId, email]
    );
    if (!sub) return res.status(403).json({ error: 'not_subscribed' });
    const b = req.body || {};
    const type = CERT_TYPES.includes(String(b.type || '').toUpperCase()) ? String(b.type).toUpperCase() : 'OTHER';
    const nationality = CERT_NATS.includes(String(b.nationality || '').toUpperCase()) ? String(b.nationality).toUpperCase() : null;
    if (!b.courseId) return res.status(400).json({ error: 'courseId required' });
    const [[eligible]] = await pool.query(
      `SELECT e.id
         FROM enrollments e
         JOIN course_completions cc ON cc.subscriber_id=e.subscriber_id AND cc.course_id=e.course_id AND cc.tenant_id=e.tenant_id AND cc.status='active'
        WHERE e.subscriber_id=? AND e.course_id=? AND e.tenant_id=? AND e.status='active'
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
    const [[duplicate]] = await pool.query(
      `SELECT id FROM certificate_requests
        WHERE tenant_id=? AND subscriber_id=? AND course_id=? AND type=?
          AND status <> 'DELIVERED'
        LIMIT 1`,
      [tenantId, sub.id, b.courseId, type]
    );
    if (duplicate) {
      return res.status(409).json({ error: 'certificate_request_exists', id: duplicate.id });
    }

    const content = await getTenantSetting('content', { tenantId, fallback: {} });
    const pricingConfig = (() => { try { return JSON.parse(content.extra_cert_pricing || '{}'); } catch { return {}; } })();
    const clientContext = await resolveClientContext(req);
    if (!clientContext.locationResolved) {
      return res.status(503).json({ error: 'Customer location could not be verified', code: 'LOCATION_UNAVAILABLE' });
    }
    const { price, currency, status } = resolveCertificatePrice({
      type, nationality, countryCode: clientContext.countryCode, pricingConfig,
    });
    const requestId = require('crypto').randomUUID();
    await pool.query(
      `INSERT INTO certificate_requests
         (id, subscriber_id, course_id, type, custom_name, name_ar, name_en, nationality, id_number, status, price, currency, note, tenant_id, requested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [requestId, sub.id, b.courseId, type, b.customName || null, b.nameAr || null, b.nameEn || null,
       nationality, b.idNumber || null, status, price, currency, b.note || null, tenantId]
    );
    res.json({ ok: true, id: requestId, status: status.toLowerCase(), price, currency });
  } catch (e) {
    logger.error('[route]', e.message);
    if (e?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'certificate_request_exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
